import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Brand } from "./components/Brand";
import { loadPublicConfig } from "./config";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element was not found.");
}

const root = createRoot(rootElement);

try {
  root.render(<App config={loadPublicConfig()} />);
} catch {
  root.render(
    <main className="session-page">
      <div className="session-card" role="alert">
        <Brand />
        <h1>GrapeScrape is not configured</h1>
        <p>
          Public authentication and API settings are missing or invalid. Check
          the frontend setup guide before starting the application.
        </p>
      </div>
    </main>,
  );
}
