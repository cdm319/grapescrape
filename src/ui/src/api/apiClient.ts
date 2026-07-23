export interface ResponseMeta {
  requestId: string;
  nextCursor?: string | null;
}

export interface SuccessEnvelope<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ApiErrorDetail {
  field?: string;
  reason?: string;
  [key: string]: unknown;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[] | Record<string, unknown>;
  };
  meta?: {
    requestId?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[] | Record<string, unknown>;
  readonly requestId?: string;

  constructor({
    status,
    code,
    message,
    details,
    requestId,
  }: {
    status: number;
    code: string;
    message: string;
    details?: ApiErrorDetail[] | Record<string, unknown>;
    requestId?: string;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }

  const error = Reflect.get(value, "error");

  return (
    !!error &&
    typeof error === "object" &&
    typeof Reflect.get(error, "code") === "string" &&
    typeof Reflect.get(error, "message") === "string"
  );
}

function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelope<T> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const meta = Reflect.get(value, "meta");

  return (
    Reflect.has(value, "data") &&
    !!meta &&
    typeof meta === "object" &&
    typeof Reflect.get(meta, "requestId") === "string"
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface ApiClient {
  request: <T>(
    path: string,
    options?: Omit<RequestInit, "headers"> & { headers?: HeadersInit },
  ) => Promise<SuccessEnvelope<T>>;
}

type ApiRequestOptions = Omit<RequestInit, "headers"> & {
  headers?: HeadersInit;
};

export function createApiClient({
  baseUrl,
  getAccessToken,
  onUnauthenticated,
  fetcher = fetch,
}: {
  baseUrl: string;
  getAccessToken: () => string | null;
  onUnauthenticated: () => void;
  fetcher?: typeof fetch;
}): ApiClient {
  return {
    async request<T>(path: string, options: ApiRequestOptions = {}) {
      const accessToken = getAccessToken();

      if (!accessToken) {
        onUnauthenticated();
        throw new ApiError({
          status: 401,
          code: "UNAUTHENTICATED",
          message: "Your session has expired. Please sign in again.",
        });
      }

      const headers = new Headers(options.headers);
      headers.set("Accept", "application/json");
      headers.set("Authorization", `Bearer ${accessToken}`);

      if (options.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      let response: Response;

      try {
        response = await fetcher(`${baseUrl}${path}`, {
          ...options,
          headers,
        });
      } catch {
        throw new ApiError({
          status: 0,
          code: "NETWORK_ERROR",
          message: "The service could not be reached. Check your connection.",
        });
      }

      const body = await readJson(response);

      if (response.status === 401) {
        onUnauthenticated();
        throw new ApiError({
          status: 401,
          code: "UNAUTHENTICATED",
          message: "Your session has expired. Please sign in again.",
        });
      }

      if (!response.ok) {
        if (isErrorEnvelope(body)) {
          throw new ApiError({
            status: response.status,
            code: body.error.code,
            message: body.error.message,
            details: body.error.details,
            requestId: body.meta?.requestId,
          });
        }

        throw new ApiError({
          status: response.status,
          code: "INTERNAL_ERROR",
          message: "The service returned an unexpected response.",
        });
      }

      if (!isSuccessEnvelope<T>(body)) {
        throw new ApiError({
          status: response.status,
          code: "INVALID_RESPONSE",
          message: "The service returned an unexpected response.",
        });
      }

      return body;
    },
  };
}
