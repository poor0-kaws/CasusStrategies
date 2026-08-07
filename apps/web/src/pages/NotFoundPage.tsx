import { ArrowLeft } from "lucide-react";

import { AppLink } from "../components/AppLink";

export function NotFoundPage() {
  return (
    <div className="content-width page-content not-found">
      <div className="eyebrow">404</div>
      <h1>Page not found</h1>
      <p>The requested page is not part of the Casus Strategies public report.</p>
      <AppLink className="text-link" to="/">
        <ArrowLeft aria-hidden="true" size={17} /> Return to overview
      </AppLink>
    </div>
  );
}
