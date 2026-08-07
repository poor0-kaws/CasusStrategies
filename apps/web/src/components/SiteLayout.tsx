import { BarChart3, Landmark, PieChart, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { AppLink } from "./AppLink";

interface SiteLayoutProps {
  children: ReactNode;
  currentPath: string;
}

const navigation = [
  { label: "Overview", to: "/", icon: BarChart3, end: true },
  { label: "Reports", to: "/reports", icon: Landmark, end: false },
  { label: "Methodology", to: "/methodology", icon: PieChart, end: false },
];

export function SiteLayout({ children, currentPath }: SiteLayoutProps) {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="site-header">
        <div className="header-inner">
          <AppLink className="wordmark" to="/" aria-label="Casus Strategies home">
            <span className="wordmark-symbol" aria-hidden="true">
              C
            </span>
            <span>Casus Strategies</span>
          </AppLink>

          <nav className="main-nav" aria-label="Primary navigation">
            {navigation.map(({ label, to, icon: Icon, end }) => (
              <AppLink
                aria-label={label}
                aria-current={
                  currentPath === to || (!end && currentPath.startsWith(to)) ? "page" : undefined
                }
                className={`nav-link${currentPath === to || (!end && currentPath.startsWith(to)) ? " nav-link-active" : ""}`}
                key={to}
                to={to}
              >
                <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                <span>{label}</span>
              </AppLink>
            ))}
          </nav>
        </div>
      </header>

      <main id="main-content">{children}</main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div>
            <strong>Casus Strategies</strong>
            <p>Independent prediction-market research.</p>
          </div>
          <div className="footer-disclaimer">
            <ShieldCheck aria-hidden="true" size={18} />
            <p>Paper trading only. No real money is traded or managed.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
