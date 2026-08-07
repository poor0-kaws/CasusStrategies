// This file provides the shared Casus header, navigation, and footer around every route.

import { BarChart3, FileText, Network } from "lucide-react";
import type { ReactNode } from "react";

import { AppLink } from "./AppLink";
import { LogoMark } from "./LogoMark";

interface SiteLayoutProps {
  children: ReactNode;
  currentPath: string;
}

const navigation = [
  { label: "Overview", to: "/", icon: BarChart3, end: true },
  { label: "Reports", to: "/reports", icon: FileText, end: false },
  { label: "Methodology", to: "/methodology", icon: Network, end: false },
];

export function SiteLayout({ children, currentPath }: SiteLayoutProps) {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="site-header">
        <div className="header-inner">
          <AppLink aria-label="Casus Strategies home" className="wordmark" to="/">
            <LogoMark />
            <span>Casus Strategies</span>
          </AppLink>

          <nav aria-label="Primary navigation" className="main-nav">
            {navigation.map(({ label, to, icon: Icon, end }) => {
              const active = currentPath === to || (!end && currentPath.startsWith(to));
              return (
                <AppLink
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  className={`nav-link${active ? " nav-link-active" : ""}`}
                  key={to}
                  to={to}
                >
                  <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                  <span>{label}</span>
                </AppLink>
              );
            })}
          </nav>
        </div>
      </header>

      <main id="main-content">{children}</main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <LogoMark />
            <div>
              <strong>Casus Strategies</strong>
              <p>AI-native event-driven research.</p>
            </div>
          </div>
          <p className="footer-note">New York · Monthly reporting</p>
        </div>
      </footer>
    </div>
  );
}
