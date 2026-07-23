import {
  UserManager,
  WebStorageStateStore,
  type User,
} from "oidc-client-ts";
import type { PublicConfig } from "../config";

export interface AuthSession {
  accessToken: string;
  expired: boolean;
  returnTo?: unknown;
}

export interface AuthEventHandlers {
  onSessionLoaded: (session: AuthSession) => void;
  onSessionEnded: () => void;
  onSessionExpired: () => void;
  onSessionError: () => void;
}

export interface AuthClient {
  restoreSession: () => Promise<AuthSession | null>;
  beginSignIn: (returnTo: string) => Promise<void>;
  completeSignIn: () => Promise<AuthSession>;
  clearSession: () => Promise<void>;
  beginLogout: () => Promise<void>;
  subscribe: (handlers: AuthEventHandlers) => () => void;
}

function toAuthSession(user: User): AuthSession {
  return {
    accessToken: user.access_token,
    expired: Boolean(user.expired),
    returnTo: user.state,
  };
}

export function safeReturnTo(value: unknown): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  ) {
    return value;
  }

  return "/";
}

export function buildCognitoLogoutUrl(config: PublicConfig): string {
  const logoutUrl = new URL("/logout", config.authDomain);
  logoutUrl.searchParams.set("client_id", config.userPoolClientId);
  logoutUrl.searchParams.set("logout_uri", config.logoutUrl);
  return logoutUrl.toString();
}

export function createAuthClient(
  config: PublicConfig,
  storage: Storage = window.sessionStorage,
  redirect: (url: string) => void = (url) => window.location.assign(url),
): AuthClient {
  const issuer = `https://cognito-idp.${config.cognitoRegion}.amazonaws.com/${config.userPoolId}`;
  const userManager = new UserManager({
    authority: issuer,
    client_id: config.userPoolClientId,
    redirect_uri: config.callbackUrl,
    post_logout_redirect_uri: config.logoutUrl,
    response_type: "code",
    scope: "openid email profile",
    automaticSilentRenew: true,
    loadUserInfo: false,
    userStore: new WebStorageStateStore({ store: storage }),
    stateStore: new WebStorageStateStore({ store: storage }),
    metadata: {
      issuer,
      authorization_endpoint: `${config.authDomain}/oauth2/authorize`,
      token_endpoint: `${config.authDomain}/oauth2/token`,
      userinfo_endpoint: `${config.authDomain}/oauth2/userInfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
    },
  });

  return {
    async restoreSession() {
      const storedUser = await userManager.getUser();

      if (!storedUser) {
        return null;
      }

      if (!storedUser.expired) {
        return toAuthSession(storedUser);
      }

      try {
        const renewedUser = await userManager.signinSilent();
        return renewedUser
          ? toAuthSession(renewedUser)
          : toAuthSession(storedUser);
      } catch {
        return toAuthSession(storedUser);
      }
    },

    async beginSignIn(returnTo) {
      await userManager.clearStaleState();
      await userManager.signinRedirect({ state: safeReturnTo(returnTo) });
    },

    async completeSignIn() {
      return toAuthSession(await userManager.signinRedirectCallback());
    },

    async clearSession() {
      await userManager.removeUser();
    },

    async beginLogout() {
      await userManager.removeUser();
      redirect(buildCognitoLogoutUrl(config));
    },

    subscribe(handlers) {
      const loaded = (user: User) => handlers.onSessionLoaded(toAuthSession(user));
      const ended = () => handlers.onSessionEnded();
      const expired = () => handlers.onSessionExpired();
      const error = () => handlers.onSessionError();

      userManager.events.addUserLoaded(loaded);
      userManager.events.addUserUnloaded(ended);
      userManager.events.addAccessTokenExpired(expired);
      userManager.events.addSilentRenewError(error);

      return () => {
        userManager.events.removeUserLoaded(loaded);
        userManager.events.removeUserUnloaded(ended);
        userManager.events.removeAccessTokenExpired(expired);
        userManager.events.removeSilentRenewError(error);
      };
    },
  };
}
