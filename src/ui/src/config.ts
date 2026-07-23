export interface PublicConfig {
  apiBaseUrl: string;
  authDomain: string;
  cognitoRegion: string;
  userPoolId: string;
  userPoolClientId: string;
  callbackUrl: string;
  logoutUrl: string;
}

type PublicEnvironment = Record<string, string | undefined>;

function requiredValue(environment: PublicEnvironment, name: string): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing public configuration: ${name}`);
  }

  return value;
}

function parsePublicUrl(
  value: string,
  name: string,
  options: { browserOrigin?: string; requireRootPath?: boolean } = {},
): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid public configuration: ${name}`);
  }

  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error(`Invalid public configuration: ${name} must use HTTPS`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid public configuration: ${name}`);
  }

  if (options.requireRootPath && url.pathname !== "/") {
    throw new Error(`Invalid public configuration: ${name}`);
  }

  if (options.browserOrigin && url.origin !== options.browserOrigin) {
    throw new Error(
      `Invalid public configuration: ${name} must match the application origin`,
    );
  }

  return url;
}

export function loadPublicConfig(
  environment: PublicEnvironment = import.meta.env,
  browserOrigin = window.location.origin,
): PublicConfig {
  const apiBaseUrl = parsePublicUrl(
    requiredValue(environment, "VITE_API_BASE_URL"),
    "VITE_API_BASE_URL",
  );
  const authDomain = parsePublicUrl(
    requiredValue(environment, "VITE_COGNITO_AUTH_DOMAIN"),
    "VITE_COGNITO_AUTH_DOMAIN",
    { requireRootPath: true },
  );
  const callbackUrl = parsePublicUrl(
    requiredValue(environment, "VITE_COGNITO_CALLBACK_URL"),
    "VITE_COGNITO_CALLBACK_URL",
    { browserOrigin },
  );
  const logoutUrl = parsePublicUrl(
    requiredValue(environment, "VITE_COGNITO_LOGOUT_URL"),
    "VITE_COGNITO_LOGOUT_URL",
    { browserOrigin },
  );
  const cognitoRegion = requiredValue(
    environment,
    "VITE_COGNITO_REGION",
  );
  const userPoolId = requiredValue(
    environment,
    "VITE_COGNITO_USER_POOL_ID",
  );
  const userPoolClientId = requiredValue(
    environment,
    "VITE_COGNITO_CLIENT_ID",
  );

  if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(cognitoRegion)) {
    throw new Error(
      "Invalid public configuration: VITE_COGNITO_REGION",
    );
  }

  if (
    !userPoolId.startsWith(`${cognitoRegion}_`) ||
    !/^[a-z0-9-]+_[A-Za-z0-9]+$/.test(userPoolId)
  ) {
    throw new Error(
      "Invalid public configuration: VITE_COGNITO_USER_POOL_ID",
    );
  }

  if (!/^[A-Za-z0-9]+$/.test(userPoolClientId)) {
    throw new Error(
      "Invalid public configuration: VITE_COGNITO_CLIENT_ID",
    );
  }

  if (callbackUrl.pathname !== "/auth/callback") {
    throw new Error(
      "Invalid public configuration: VITE_COGNITO_CALLBACK_URL",
    );
  }

  return {
    apiBaseUrl: apiBaseUrl.toString().replace(/\/$/, ""),
    authDomain: authDomain.origin,
    cognitoRegion,
    userPoolId,
    userPoolClientId,
    callbackUrl: callbackUrl.toString(),
    logoutUrl: logoutUrl.toString(),
  };
}
