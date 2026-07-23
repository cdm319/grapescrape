import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../../src/ui/src/App";
import { AuthProvider } from "../../../src/ui/src/auth/AuthProvider";
import {
  buildCognitoLogoutUrl,
  safeReturnTo,
  type AuthClient,
  type AuthEventHandlers,
  type AuthSession,
} from "../../../src/ui/src/auth/authClient";
import type { PublicConfig } from "../../../src/ui/src/config";

function createFakeAuthClient({
  session = null,
  callbackSession,
  callbackError = false,
}: {
  session?: AuthSession | null;
  callbackSession?: AuthSession;
  callbackError?: boolean;
} = {}) {
  const client: AuthClient = {
    restoreSession: vi.fn().mockResolvedValue(session),
    beginSignIn: vi.fn().mockResolvedValue(undefined),
    completeSignIn: callbackError
      ? vi.fn().mockRejectedValue(new Error("Invalid callback"))
      : vi
          .fn()
          .mockResolvedValue(
            callbackSession ?? {
              accessToken: "callback-token",
              expired: false,
              returnTo: "/",
            },
          ),
    clearSession: vi.fn().mockResolvedValue(undefined),
    beginLogout: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((_handlers: AuthEventHandlers) => () => {}),
  };

  return { client };
}

function renderRoutes(client: AuthClient, initialEntry: string) {
  return render(
    <AuthProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("authenticated application routing", () => {
  it("restores a valid session before rendering protected routes", async () => {
    const { client } = createFakeAuthClient({
      session: { accessToken: "access-token", expired: false },
    });

    renderRoutes(client, "/wines");

    expect(
      await screen.findByRole("heading", { name: "Available wines" }),
    ).toBeInTheDocument();
    expect(client.beginSignIn).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated user and preserves the intended route", async () => {
    const { client } = createFakeAuthClient();

    renderRoutes(client, "/history?fit=good");

    await waitFor(() => {
      expect(client.beginSignIn).toHaveBeenCalledWith(
        "/history?fit=good",
      );
    });
    expect(
      screen.getByRole("heading", { name: "Opening secure sign-in" }),
    ).toBeInTheDocument();
  });

  it("shows a recoverable state when the stored session has expired", async () => {
    const { client } = createFakeAuthClient({
      session: { accessToken: "expired-token", expired: true },
    });

    renderRoutes(client, "/palate");

    expect(
      await screen.findByRole("heading", {
        name: "Your session has expired",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in again" }),
    ).toBeInTheDocument();
  });

  it("retries managed login after the first redirect attempt fails", async () => {
    const { client } = createFakeAuthClient();
    vi.mocked(client.beginSignIn).mockRejectedValueOnce(
      new Error("Redirect unavailable"),
    );

    renderRoutes(client, "/wines");

    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(client.beginSignIn).toHaveBeenCalledTimes(2);
    });
    expect(client.beginSignIn).toHaveBeenLastCalledWith("/wines");
  });

  it("completes the callback and returns to the intended protected route", async () => {
    const { client } = createFakeAuthClient({
      callbackSession: {
        accessToken: "callback-token",
        expired: false,
        returnTo: "/history",
      },
    });

    renderRoutes(client, "/auth/callback?code=example&state=example");

    expect(
      await screen.findByRole("heading", { name: "Assessment history" }),
    ).toBeInTheDocument();
    expect(client.completeSignIn).toHaveBeenCalledOnce();
  });

  it("shows a retry action when the callback cannot be completed", async () => {
    const { client } = createFakeAuthClient({ callbackError: true });

    renderRoutes(client, "/auth/callback?code=invalid&state=invalid");

    expect(
      await screen.findByRole("heading", {
        name: "Sign-in needs another try",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in again" }),
    ).toBeInTheDocument();
  });
});

describe("Cognito navigation safety", () => {
  it("accepts only application-relative callback destinations", () => {
    expect(safeReturnTo("/wines?fit=good")).toBe("/wines?fit=good");
    expect(safeReturnTo("https://unexpected.example")).toBe("/");
    expect(safeReturnTo("//unexpected.example")).toBe("/");
  });

  it("builds logout from validated public configuration", () => {
    const config: PublicConfig = {
      apiBaseUrl: "https://api.grapescrape.com",
      authDomain: "https://auth.grapescrape.com",
      cognitoRegion: "eu-west-2",
      userPoolId: "eu-west-2_example123",
      userPoolClientId: "publicclient123",
      callbackUrl: "https://app.grapescrape.com/auth/callback",
      logoutUrl: "https://app.grapescrape.com/",
    };

    expect(buildCognitoLogoutUrl(config)).toBe(
      "https://auth.grapescrape.com/logout?client_id=publicclient123&logout_uri=https%3A%2F%2Fapp.grapescrape.com%2F",
    );
  });
});
