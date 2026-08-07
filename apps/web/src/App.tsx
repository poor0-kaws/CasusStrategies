import { useEffect, useState } from "react";

import { SiteLayout } from "./components/SiteLayout";
import { MethodologyPage } from "./pages/MethodologyPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ReportsPage } from "./pages/ReportsPage";

export function App() {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    function updatePath() {
      setCurrentPath(normalizePath(window.location.pathname));
      window.scrollTo({ top: 0 });
    }

    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  return <SiteLayout currentPath={currentPath}>{renderPage(currentPath)}</SiteLayout>;
}

function normalizePath(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/$/, "");
}

function renderPage(pathname: string) {
  if (pathname === "/") {
    return <OverviewPage />;
  }

  if (pathname === "/reports") {
    return <ReportsPage />;
  }

  if (pathname === "/methodology") {
    return <MethodologyPage />;
  }

  return <NotFoundPage />;
}
