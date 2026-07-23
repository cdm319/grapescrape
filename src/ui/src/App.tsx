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
import { AppShell } from "./components/AppShell";
import type { PublicConfig } from "./config";
import { CallbackPage } from "./pages/CallbackPage";
import { HomeDashboardRoute } from "./pages/HomeDashboardPage";
import {
  AssessWinePage,
  HistoryPage,
  NotFoundPage,
  PalatePage,
  WinesPage,
} from "./pages/PlaceholderPages";

export function AppRoutes({ config }: { config: PublicConfig }) {
  return (
    <Routes>
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<HomeDashboardRoute config={config} />} />
          <Route path="wines" element={<WinesPage />} />
          <Route path="palate" element={<PalatePage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="assess" element={<AssessWinePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
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
        <BrowserRouter>
          <AppRoutes config={config} />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
