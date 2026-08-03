import { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router-dom";
import {
  ApiClientProvider,
  useAuthenticatedApiClient,
} from "./api/ApiClientProvider";
import { AuthProvider } from "./auth/AuthProvider";
import { createAuthClient, type AuthClient } from "./auth/authClient";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import type { ApiClient } from "./api/apiClient";
import { AppShell } from "./components/AppShell";
import type { PublicConfig } from "./config";
import { AssessedWineDetail } from "./pages/AssessedWineDetail";
import { AssessedWineHistoryPage } from "./pages/AssessedWineHistoryPage";
import { CallbackPage } from "./pages/CallbackPage";
import { HomeDashboardRoute } from "./pages/HomeDashboardPage";
import { ManualWinesRoute } from "./pages/ManualWinesPage";
import {
  NotFoundPage,
  WinesPage,
} from "./pages/PlaceholderPages";
import { PalateProfilePage } from "./pages/PalateProfilePage";

export function AppRoutes({ apiClient }: { apiClient: ApiClient }) {
  return (
    <Routes>
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<HomeDashboardRoute apiClient={apiClient} />} />
          <Route path="wines" element={<WinesPage />} />
          <Route path="palate" element={<PalateProfilePage />} />
          <Route
            path="history"
            element={<AssessedWineHistoryPage apiClient={apiClient} />}
          >
            <Route
              path=":sourceKey"
              element={<AssessedWineDetail apiClient={apiClient} />}
            />
          </Route>
          <Route
            path="assess"
            element={<ManualWinesRoute apiClient={apiClient} />}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

function AuthenticatedApplication() {
  const apiClient = useAuthenticatedApiClient();

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
        <ApiClientProvider config={config}>
          <AuthenticatedApplication />
        </ApiClientProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
