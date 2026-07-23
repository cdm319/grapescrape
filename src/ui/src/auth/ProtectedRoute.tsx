import { useEffect, useRef, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Button } from "../components/Primitives";
import { Brand } from "../components/Brand";
import { useAuth } from "./AuthProvider";

function SessionPage({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <main className="session-page">
      <div className="session-card">
        <Brand />
        <h1>{title}</h1>
        <p>{message}</p>
        {action}
      </div>
    </main>
  );
}

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  const redirectStarted = useRef(false);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (auth.status === "unauthenticated" && !redirectStarted.current) {
      redirectStarted.current = true;
      void auth.signIn(returnTo);
    }
  }, [auth, returnTo]);

  if (auth.status === "authenticated") {
    return <Outlet />;
  }

  if (auth.status === "expired") {
    return (
      <SessionPage
        title="Your session has expired"
        message="For your security, you have been signed out. Sign in again to pick up where you left off."
        action={
          <Button onClick={() => void auth.signIn(returnTo)}>
            Sign in again
          </Button>
        }
      />
    );
  }

  if (auth.status === "error") {
    return (
      <SessionPage
        title="We could not start your session"
        message={
          auth.message ??
          "Check your connection, then try restoring your session."
        }
        action={<Button onClick={auth.retrySession}>Try again</Button>}
      />
    );
  }

  return (
    <SessionPage
      title={
        auth.status === "loading"
          ? "Restoring your session"
          : "Opening secure sign-in"
      }
      message="You will continue in Cognito managed login."
      action={<span className="spinner" aria-label="Loading" />}
    />
  );
}
