interface Allocation {
  label: string;
  value: number;
  color: string;
}

const allocations: Allocation[] = [
  { label: "Cash and unallocated", value: 80, color: "#27313a" },
  { label: "Weather", value: 12, color: "#17877b" },
  { label: "Economics", value: 8, color: "#c4772b" },
];

export function AllocationDonut() {
  let offset = 0;

  return (
    <div className="allocation-layout">
      <svg
        className="allocation-chart"
        role="img"
        viewBox="0 0 240 240"
        aria-labelledby="allocation-title allocation-description"
      >
        <title id="allocation-title">Maximum capital posture</title>
        <desc id="allocation-description">
          Eighty percent cash and unallocated, twelve percent weather, and eight percent economics.
        </desc>
        <circle className="donut-track" cx="120" cy="120" fill="none" r="78" strokeWidth="34" />
        {allocations.map((allocation) => {
          const currentOffset = offset;
          offset += allocation.value;

          return (
            <circle
              key={allocation.label}
              cx="120"
              cy="120"
              fill="none"
              r="78"
              pathLength="100"
              stroke={allocation.color}
              strokeDasharray={`${allocation.value} ${100 - allocation.value}`}
              strokeDashoffset={-currentOffset}
              strokeWidth="34"
              transform="rotate(-90 120 120)"
            >
              <title>{`${allocation.label}: ${allocation.value}%`}</title>
            </circle>
          );
        })}
        <text className="donut-value" x="120" y="116" textAnchor="middle">
          20%
        </text>
        <text className="donut-label" x="120" y="140" textAnchor="middle">
          max exposure
        </text>
      </svg>

      <ul className="allocation-legend" aria-label="Capital posture legend">
        {allocations.map((allocation) => (
          <li key={allocation.label}>
            <span
              className="legend-swatch"
              style={{ backgroundColor: allocation.color }}
              aria-hidden="true"
            />
            <span>{allocation.label}</span>
            <strong>{allocation.value}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
