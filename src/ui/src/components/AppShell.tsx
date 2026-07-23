import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Brand } from "./Brand";
import { Button } from "./Primitives";

const navigation = [
  { to: "/", label: "Home", icon: "⌂" },
  { to: "/wines", label: "Wines", icon: "◇" },
  { to: "/palate", label: "Palate", icon: "◌" },
  { to: "/history", label: "History", icon: "↺" },
];

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      className={mobile ? "mobile-navigation" : "desktop-navigation"}
      aria-label={mobile ? "Mobile navigation" : "Primary navigation"}
    >
      {navigation.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          {mobile && (
            <span className="mobile-navigation__icon" aria-hidden="true">
              {item.icon}
            </span>
          )}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <Brand linked />
          <Navigation />
          <div className="header-actions">
            <Button
              className="assess-button"
              onClick={() => navigate("/assess")}
            >
              <span aria-hidden="true">+</span>
              <span>Assess a wine</span>
            </Button>
            <Button
              className="sign-out-button"
              variant="quiet"
              onClick={() => void auth.signOut()}
              aria-label="Sign out"
            >
              <span className="sign-out-button__wide">Sign out</span>
              <span className="sign-out-button__compact" aria-hidden="true">
                ↗
              </span>
            </Button>
          </div>
        </div>
      </header>
      <main id="main-content" className="app-content" tabIndex={-1}>
        <Outlet />
      </main>
      <Navigation mobile />
    </div>
  );
}
