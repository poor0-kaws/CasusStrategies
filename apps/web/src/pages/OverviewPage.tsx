import { ArrowRight, CalendarDays, CircleDollarSign, ShieldCheck } from "lucide-react";

import { AppLink } from "../components/AppLink";
import { FundChart } from "../components/FundChart";
import { fundReport } from "../data/fund-report";
import { calculateTotalReturn, formatCurrency, formatPercent, formatPeriod } from "../reporting";

export function OverviewPage() {
  const latestMonth = fundReport.months.at(-1);
  const latestNav = latestMonth?.closingNav ?? fundReport.startingNav;
  const totalReturn = calculateTotalReturn(fundReport);
  const dataStatus =
    fundReport.status === "official"
      ? "Official PredArena paper results through the latest completed month"
      : "Illustrative preview. Shadow mode submits no paper orders and has no official record";
  const navLabel = fundReport.status === "official" ? "Simulated NAV" : "Illustrative NAV";
  const returnLabel = fundReport.status === "official" ? "Overall return" : "Illustrative return";

  return (
    <>
      <section className="hero-band">
        <div className="content-width hero-content">
          <div className="eyebrow">Independent paper fund</div>
          <h1>Casus Strategies</h1>
          <p className="hero-summary">
            Patient prediction-market research built around public evidence, conservative forecasts,
            and controlled risk.
          </p>
          <div className="paper-notice" role="note">
            <ShieldCheck aria-hidden="true" size={20} />
            <span>Research simulation only. No real money is traded or managed.</span>
          </div>
        </div>
      </section>

      <section className="metric-band" aria-label="Fund summary">
        <div className="content-width metric-grid">
          <div className="metric-item">
            <span className="metric-label">
              <CircleDollarSign aria-hidden="true" size={17} /> {navLabel}
            </span>
            <strong>{formatCurrency(latestNav)}</strong>
          </div>
          <div className="metric-item">
            <span className="metric-label">{returnLabel}</span>
            <strong className={totalReturn >= 0 ? "value-positive" : "value-negative"}>
              {formatPercent(totalReturn)}
            </strong>
          </div>
          <div className="metric-item">
            <span className="metric-label">
              <CalendarDays aria-hidden="true" size={17} /> Report through
            </span>
            <strong>
              {latestMonth ? formatPeriod(latestMonth.period, true) : "Pre-inception"}
            </strong>
          </div>
        </div>
      </section>

      <section className="content-width section-block" aria-labelledby="progress-heading">
        <div className="section-heading-row">
          <div>
            <div className="eyebrow">Month-end record</div>
            <h2 id="progress-heading">Fund value progression</h2>
          </div>
          <p className="data-status">{dataStatus}</p>
        </div>
        <FundChart report={fundReport} />
      </section>

      <section className="principles-band">
        <div className="content-width principles-grid">
          <div>
            <div className="eyebrow">Operating posture</div>
            <h2>Deliberate by design</h2>
          </div>
          <div className="principle-copy">
            <p>
              Casus focuses on slower weather and economic markets where careful interpretation
              matters more than millisecond speed.
            </p>
            <p>
              Every candidate must survive contract review, evidence checks, conservative pricing,
              and portfolio risk limits before a simulated order can be placed.
            </p>
            <AppLink className="text-link" to="/methodology">
              Read the methodology <ArrowRight aria-hidden="true" size={17} />
            </AppLink>
          </div>
        </div>
      </section>
    </>
  );
}
