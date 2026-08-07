import { AllocationDonut } from "../components/AllocationDonut";

const principles = [
  {
    number: "01",
    title: "Start with exact rules",
    copy: "A market is considered only when its deadline, resolution source, and edge cases can be understood clearly.",
  },
  {
    number: "02",
    title: "Use public evidence",
    copy: "Research begins with time-stamped government, weather, and economic sources available to every participant.",
  },
  {
    number: "03",
    title: "Forecast conservatively",
    copy: "Several independent estimates are combined, calibrated, and reduced for uncertainty before prices are compared.",
  },
  {
    number: "04",
    title: "Respect execution",
    copy: "A simulated trade must still survive visible liquidity, fees, slippage, concentration, and loss limits.",
  },
];

export function MethodologyPage() {
  return (
    <div className="page-content">
      <header className="content-width page-intro methodology-intro">
        <div className="eyebrow">Research discipline</div>
        <h1>Methodology</h1>
        <p>
          Casus studies places where careful reading and measured probability updates can matter
          more than raw trading speed.
        </p>
      </header>

      <section className="method-band" aria-labelledby="process-heading">
        <div className="content-width method-layout">
          <div>
            <div className="eyebrow">Core process</div>
            <h2 id="process-heading">From evidence to decision</h2>
          </div>
          <ol className="principle-list">
            {principles.map((principle) => (
              <li key={principle.number}>
                <span className="principle-number" aria-hidden="true">
                  {principle.number}
                </span>
                <div>
                  <h3>{principle.title}</h3>
                  <p>{principle.copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className="content-width section-block allocation-section"
        aria-labelledby="allocation-heading"
      >
        <div className="allocation-copy">
          <div className="eyebrow">Capital posture</div>
          <h2 id="allocation-heading">Risk before opportunity</h2>
          <p>
            At least 80% of paper capital remains unallocated in version one. Weather and economics
            share a maximum 20% open-exposure budget; these limits are ceilings, not targets.
          </p>
        </div>
        <AllocationDonut />
      </section>

      <section className="research-band" aria-labelledby="frontier-heading">
        <div className="content-width research-layout">
          <div>
            <div className="eyebrow">Research frontier</div>
            <h2 id="frontier-heading">Relationships without shortcuts</h2>
          </div>
          <p>
            Casus also studies logically connected markets, such as equivalent questions and
            threshold ladders. This work remains research-only until each relationship and every
            required simulated order can be verified by ordinary, repeatable rules.
          </p>
        </div>
      </section>
    </div>
  );
}
