import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthClient, AuthSession } from "./authClient";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "expired"
  | "error";

interface AuthState {
  status: AuthStatus;
  session: AuthSession | null;
  message?: string;
}

interface AuthContextValue extends AuthState {
  accessToken: string | null;
  signIn: (returnTo: string) => Promise<void>;
  completeSignIn: () => Promise<string>;
  signOut: () => Promise<void>;
  expireSession: () => void;
  retrySession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function stateForSession(session: AuthSession | null): AuthState {
  if (!session) {
    return { status: "unauthenticated", session: null };
  }

  if (session.expired) {
    return { status: "expired", session: null };
  }

  return { status: "authenticated", session };
}

export function AuthProvider({
  client,
  children,
}: {
  client: AuthClient;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    session: null,
  });
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const sessionRevision = useRef(0);

  useEffect(() => {
    let active = true;
    const revision = ++sessionRevision.current;

    client
      .restoreSession()
      .then((session) => {
        if (active && sessionRevision.current === revision) {
          setState(stateForSession(session));
        }
      })
      .catch(() => {
        if (active && sessionRevision.current === revision) {
          setState({
            status: "error",
            session: null,
            message: "We could not restore your session.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [client, restoreAttempt]);

  useEffect(
    () =>
      client.subscribe({
        onSessionLoaded: (session) => {
          sessionRevision.current += 1;
          setState(stateForSession(session));
        },
        onSessionEnded: () => {
          sessionRevision.current += 1;
          setState({ status: "unauthenticated", session: null });
        },
        onSessionExpired: () => {
          sessionRevision.current += 1;
          setState({ status: "expired", session: null });
        },
        onSessionError: () => {
          sessionRevision.current += 1;
          setState({ status: "expired", session: null });
        },
      }),
    [client],
  );

  const signIn = useCallback(
    async (returnTo: string) => {
      try {
        await client.beginSignIn(returnTo);
      } catch {
        setState({
          status: "error",
          session: null,
          message: "We could not open the secure sign-in page.",
        });
      }
    },
    [client],
  );

  const completeSignIn = useCallback(async () => {
    try {
      const session = await client.completeSignIn();
      sessionRevision.current += 1;

      if (session.expired) {
        setState({ status: "expired", session: null });
        return "/";
      }

      setState({ status: "authenticated", session });
      return typeof session.returnTo === "string" ? session.returnTo : "/";
    } catch {
      sessionRevision.current += 1;
      setState({
        status: "error",
        session: null,
        message: "Sign-in could not be completed. Please try again.",
      });
      throw new Error("Sign-in callback failed.");
    }
  }, [client]);

  const signOut = useCallback(async () => {
    sessionRevision.current += 1;
    setState({ status: "loading", session: null });

    try {
      await client.beginLogout();
    } catch {
      setState({
        status: "error",
        session: null,
        message: "We could not sign you out safely. Please try again.",
      });
    }
  }, [client]);

  const expireSession = useCallback(() => {
    sessionRevision.current += 1;
    setState({ status: "expired", session: null });
    void client.clearSession();
  }, [client]);

  const retrySession = useCallback(() => {
    setState({ status: "loading", session: null });
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      accessToken: state.session?.accessToken ?? null,
      signIn,
      completeSignIn,
      signOut,
      expireSession,
      retrySession,
    }),
    [
      completeSignIn,
      expireSession,
      retrySession,
      signIn,
      signOut,
      state,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
