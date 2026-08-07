// This file explains Casus Strategies at a high level without exposing proprietary trade logic.

import { AllocationDonut } from "../components/AllocationDonut";
import { fundReport } from "../data/fund-report";

const principles = [
  {
    number: "01",
    title: "Interpret public evidence",
    copy: "We monitor approved primary sources across weather, economics, public policy, legal and regulatory events, and corporate disclosures. Information is time-stamped and evaluated against exact contract terms.",
  },
  {
    number: "02",
    title: "Price uncertainty conservatively",
    copy: "Multiple independent views are combined with market prices and calibrated for uncertainty. An opportunity must remain attractive after execution costs and a conservative margin for error.",
  },
  {
    number: "03",
    title: "Construct risk-aware exposure",
    copy: "Capital is allocated across sectors and connected outcomes rather than treating every contract as independent. Position size follows the portfolio risk it adds, not the confidence of one forecast alone.",
  },
] as const;

export function MethodologyPage() {
  return (
    <div className="page-content methodology-page">
      <header className="content-width page-intro methodology-intro">
        <p className="eyebrow">Investment discipline</p>
        <h1>Methodology</h1>
        <p>
          Casus is designed for markets where understanding public information and connected
          outcomes matters more than raw speed.
        </p>
      </header>

      <section aria-labelledby="principles-heading" className="method-band">
        <div className="content-width method-heading">
          <p className="eyebrow">Three public principles</p>
          <h2 id="principles-heading">A disciplined path from evidence to exposure</h2>
        </div>
        <ol className="content-width principle-list">
          {principles.map((principle) => (
            <li key={principle.number}>
              <span className="principle-number" aria-hidden="true">
                {principle.number}
              </span>
              <h3>{principle.title}</h3>
              <p>{principle.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="allocation-heading"
        className="content-width section-block allocation-section"
      >
        <div className="allocation-copy">
          <p className="eyebrow">Research allocation</p>
          <h2 id="allocation-heading">Diversified by source of uncertainty</h2>
          <p>
            The starting mix emphasizes weather and economics while maintaining meaningful research
            capacity across policy, legal, regulatory, and corporate events. Weights adjust slowly
            only after each sector develops enough resolved evidence.
          </p>
        </div>
        <AllocationDonut allocations={fundReport.sectorAllocation} />
      </section>

      <section aria-labelledby="hedging-heading" className="hedging-band">
        <div className="content-width hedging-layout">
          <div>
            <p className="eyebrow">Portfolio construction</p>
            <h2 id="hedging-heading">Hedging is part of the decision, not an afterthought.</h2>
          </div>
          <div className="hedging-copy">
            <p>
              Related markets are grouped into shared scenarios so offsetting outcomes are measured
              together. Verified two-leg structures may reduce event risk when both sides remain
              executable under conservative assumptions.
            </p>
            <p>
              Exposure is limited at the market, event cluster, sector, and total portfolio levels.
              When a hedge cannot be completed as planned, new activity stops until positions and
              records agree again.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
