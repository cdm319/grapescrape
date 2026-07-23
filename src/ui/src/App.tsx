import { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { createAuthClient, type AuthClient } from "./auth/authClient";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import type { ApiClient } from "./api/apiClient";
import { useApiClient } from "./api/useApiClient";
import { AppShell } from "./components/AppShell";
import type { PublicConfig } from "./config";
import { AssessedWineDetail } from "./pages/AssessedWineDetail";
import { AssessedWineHistoryPage } from "./pages/AssessedWineHistoryPage";
import { CallbackPage } from "./pages/CallbackPage";
import {
  AssessWinePage,
  HomePage,
  NotFoundPage,
  PalatePage,
  WinesPage,
} from "./pages/PlaceholderPages";

export function AppRoutes({ apiClient }: { apiClient: ApiClient }) {
  return (
    <Routes>
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="wines" element={<WinesPage />} />
          <Route path="palate" element={<PalatePage />} />
          <Route
            path="history"
            element={<AssessedWineHistoryPage apiClient={apiClient} />}
          >
            <Route
              path=":sourceKey"
              element={<AssessedWineDetail apiClient={apiClient} />}
            />
          </Route>
          <Route path="assess" element={<AssessWinePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

function AuthenticatedApplication({
  config,
}: {
  config: PublicConfig;
}) {
  const apiClient = useApiClient(config);

  return (
    <BrowserRouter>
      <AppRoutes apiClient={apiClient} />
    </BrowserRouter>
  );
}

export function App({
  config,
  authClient,
}: {
  config: PublicConfig;
  authClient?: AuthClient;
}) {
  const client = useMemo(
    () => authClient ?? createAuthClient(config),
    [authClient, config],
  );
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={client}>
        <AuthenticatedApplication config={config} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
