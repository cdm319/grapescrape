import { useMemo } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { PublicConfig } from "../config";
import { createApiClient, type ApiClient } from "./apiClient";

export function useApiClient(config: PublicConfig): ApiClient {
  const { accessToken, expireSession } = useAuth();

  return useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiBaseUrl,
        getAccessToken: () => accessToken,
        onUnauthenticated: expireSession,
      }),
    [accessToken, config.apiBaseUrl, expireSession],
  );
}
