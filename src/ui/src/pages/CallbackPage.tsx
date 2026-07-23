import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Brand } from "../components/Brand";
import { Button } from "../components/Primitives";
import { safeReturnTo } from "../auth/authClient";

export function CallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const callbackStarted = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (callbackStarted.current) {
      return;
    }

    callbackStarted.current = true;
    auth
      .completeSignIn()
      .then((returnTo) => navigate(safeReturnTo(returnTo), { replace: true }))
      .catch(() => setFailed(true));
  }, [auth, navigate]);

  return (
    <main className="session-page">
      <div className="session-card" role="status">
        <Brand />
        <h1>{failed ? "Sign-in needs another try" : "Completing sign-in"}</h1>
        <p>
          {failed
            ? "The secure sign-in response could not be completed."
            : "We are restoring your GrapeScrape session."}
        </p>
        {failed ? (
          <Button onClick={() => void auth.signIn("/")}>Sign in again</Button>
        ) : (
          <span className="spinner" aria-label="Loading" />
        )}
      </div>
    </main>
  );
}
