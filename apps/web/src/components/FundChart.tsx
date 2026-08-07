import type { FundReport } from "../data/fund-report";
import { formatCurrency, formatPeriod } from "../reporting";

interface FundChartProps {
  report: FundReport;
}

interface ChartPoint {
  label: string;
  value: number;
  x: number;
  y: number;
}

const minimumWidth = 820;
const height = 320;
const padding = { top: 28, right: 24, bottom: 48, left: 72 };

export function FundChart({ report }: FundChartProps) {
  const values = [report.startingNav, ...report.months.map((month) => month.closingNav)];
  const width = Math.max(minimumWidth, values.length * 92);
  const labels = ["Inception", ...report.months.map((month) => formatPeriod(month.period))];
  const minimum = Math.floor((Math.min(...values) - 20) / 20) * 20;
  const maximum = Math.ceil((Math.max(...values) + 20) / 20) * 20;
  const range = Math.max(maximum - minimum, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const points: ChartPoint[] = values.map((value, index) => ({
    value,
    label: labels[index],
    x: padding.left + (index / Math.max(values.length - 1, 1)) * plotWidth,
    y: padding.top + ((maximum - value) / range) * plotHeight,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const guideValues = [maximum, minimum + range / 2, minimum];

  return (
    <div
      aria-label="Scrollable fund value history"
      className="chart-frame"
      role="region"
      tabIndex={0}
    >
      <svg
        className="fund-chart"
        role="img"
        style={{ minWidth: width }}
        viewBox={`0 0 ${width} ${height}`}
        aria-labelledby="fund-chart-title fund-chart-description"
      >
        <title id="fund-chart-title">Simulated fund value since inception</title>
        <desc id="fund-chart-description">
          Casus Strategies began with {formatCurrency(report.startingNav)} and ends the displayed
          period at {formatCurrency(values.at(-1) ?? report.startingNav)}.
        </desc>

        {guideValues.map((guide) => {
          const y = padding.top + ((maximum - guide) / range) * plotHeight;

          return (
            <g key={guide}>
              <line
                className="chart-guide"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text className="chart-axis-label" x={padding.left - 12} y={y + 4} textAnchor="end">
                ${Math.round(guide).toLocaleString("en-US")}
              </text>
            </g>
          );
        })}

        <path className="chart-line" d={path} />

        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle className="chart-point" cx={point.x} cy={point.y} r="5">
              <title>{`${point.label}: ${formatCurrency(point.value)}`}</title>
            </circle>
            {(index === 0 || index === points.length - 1 || index % 2 === 0) && (
              <text className="chart-axis-label" x={point.x} y={height - 18} textAnchor="middle">
                {point.label.slice(0, 3)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
