// This file visualizes the current public sector mix without exposing individual positions.

import type { PublicFundReportV2, ResearchCategory } from "../data/fund-report";

interface AllocationDonutProps {
  allocations: PublicFundReportV2["sectorAllocation"];
}

const categoryDetails: Record<ResearchCategory, { label: string; color: string }> = {
  weather: { label: "Weather", color: "#2e7d4f" },
  economics: { label: "Economics", color: "#3976a5" },
  public_policy: { label: "Politics and public policy", color: "#b8862d" },
  legal_regulatory: { label: "Legal and regulatory", color: "#a45148" },
  corporate_events: { label: "Corporate events", color: "#6f5c8f" },
};

export function AllocationDonut({ allocations }: AllocationDonutProps) {
  let offset = 0;

  return (
    <div className="allocation-layout">
      <svg
        aria-labelledby="allocation-title allocation-description"
        className="allocation-chart"
        role="img"
        viewBox="0 0 240 240"
      >
        <title id="allocation-title">Deployed-capital research allocation</title>
        <desc id="allocation-description">
          Capital is allocated across weather, economics, public policy, legal and regulatory, and
          corporate event research.
        </desc>
        <circle className="donut-track" cx="120" cy="120" fill="none" r="78" strokeWidth="30" />
        {allocations.map((allocation) => {
          const currentOffset = offset;
          offset += allocation.percent;
          const details = categoryDetails[allocation.category];
          return (
            <circle
              cx="120"
              cy="120"
              fill="none"
              key={allocation.category}
              pathLength="100"
              r="78"
              stroke={details.color}
              strokeDasharray={`${allocation.percent} ${100 - allocation.percent}`}
              strokeDashoffset={-currentOffset}
              strokeWidth="30"
              transform="rotate(-90 120 120)"
            >
              <title>{`${details.label}: ${allocation.percent}%`}</title>
            </circle>
          );
        })}
        <text className="donut-value" textAnchor="middle" x="120" y="116">
          100%
        </text>
        <text className="donut-label" textAnchor="middle" x="120" y="139">
          research mix
        </text>
      </svg>

      <ul aria-label="Research allocation legend" className="allocation-legend">
        {allocations.map((allocation) => {
          const details = categoryDetails[allocation.category];
          return (
            <li key={allocation.category}>
              <span
                aria-hidden="true"
                className="legend-swatch"
                style={{ backgroundColor: details.color }}
              />
              <span>{details.label}</span>
              <strong>{allocation.percent}%</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
