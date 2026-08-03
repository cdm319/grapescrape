import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { PublicConfig } from "../config";
import type { ApiClient } from "./apiClient";
import { useApiClient } from "./useApiClient";

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  config,
  children,
}: {
  config: PublicConfig;
  children: ReactNode;
}) {
  const client = useApiClient(config);

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useAuthenticatedApiClient(): ApiClient {
  const client = useContext(ApiClientContext);

  if (!client) {
    throw new Error(
      "useAuthenticatedApiClient must be used within ApiClientProvider",
    );
  }

  return client;
}
