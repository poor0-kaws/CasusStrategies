// This file presents the fund identity, operating limits, live NAV, and public process overview.

import { ArrowRight } from "lucide-react";

import { AppLink } from "../components/AppLink";
import { FundChart } from "../components/FundChart";
import { fundReport } from "../data/fund-report";
import { calculateTotalReturn, formatCurrency, formatPercent, getLatestNav } from "../reporting";

const fundFacts = [
  ["Fund style", "AI-native event driven"],
  ["Strategy focus", "Public-information repricing"],
  ["Research universe", "Five supported sectors"],
  ["Capital deployment", "Adaptive and risk weighted"],
  ["Gross exposure limit", "75%"],
  ["Scenario-risk limit", "25%"],
] as const;

const disciplines = [
  {
    number: "01",
    title: "Interpret",
    copy: "Specialized systems monitor official public information and connect each factual change to the contracts it can affect.",
  },
  {
    number: "02",
    title: "Price",
    copy: "Independent forecasts are calibrated against the market and reduced for uncertainty, costs, and execution conditions.",
  },
  {
    number: "03",
    title: "Construct",
    copy: "Positions are sized together, with related outcomes treated as one risk cluster and hedges evaluated before capital is deployed.",
  },
] as const;

export function OverviewPage() {
  const totalReturn = calculateTotalReturn(fundReport);
  const hasLiveMonths = fundReport.liveMonths.length > 0;

  return (
    <>
      <section className="overview-intro">
        <div className="content-width intro-grid">
          <div>
            <p className="eyebrow">AI-native prediction-market fund</p>
            <h1>Casus Strategies</h1>
          </div>
          <p className="hero-summary">
            We combine machine-scale public research, calibrated forecasting, and portfolio-level
            hedging to identify event-driven opportunities across prediction markets.
          </p>
        </div>
      </section>

      <section aria-label="Fund facts" className="content-width fund-facts">
        {fundFacts.map(([label, value]) => (
          <div className="fund-fact" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section aria-label="Fund summary" className="metric-band">
        <div className="content-width metric-grid">
          <div className="metric-item">
            <span className="metric-label">Live NAV</span>
            <strong>{formatCurrency(getLatestNav(fundReport))}</strong>
          </div>
          <div className="metric-item">
            <span className="metric-label">Overall fund return</span>
            <strong className={totalReturn < 0 ? "value-negative" : "value-positive"}>
              {formatPercent(totalReturn)}
            </strong>
          </div>
          <div className="metric-item">
            <span className="metric-label">Reporting status</span>
            <strong className="status-value">
              {hasLiveMonths ? "Current through latest close" : "Awaiting first month close"}
            </strong>
          </div>
        </div>
      </section>

      <section aria-labelledby="progress-heading" className="content-width section-block">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Live monthly record</p>
            <h2 id="progress-heading">Fund progression</h2>
          </div>
          <p className="section-note">Month-end NAV · Since activation</p>
        </div>
        <FundChart report={fundReport} />
      </section>

      <section className="discipline-band">
        <div className="content-width discipline-heading">
          <div>
            <p className="eyebrow">Research architecture</p>
            <h2>Evidence becomes exposure only after it survives the portfolio.</h2>
          </div>
          <AppLink className="text-link text-link-light" to="/methodology">
            Explore our methodology <ArrowRight aria-hidden="true" size={17} />
          </AppLink>
        </div>
        <div className="content-width discipline-grid">
          {disciplines.map((discipline) => (
            <article className="discipline-item" key={discipline.number}>
              <span>{discipline.number}</span>
              <h3>{discipline.title}</h3>
              <p>{discipline.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
