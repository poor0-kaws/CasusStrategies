// This file draws the live month-end NAV line and exposes every point to mouse, touch, and keyboard.

import { useState } from "react";

import type { PublicFundReportV2 } from "../data/fund-report";
import {
  formatCurrency,
  formatPercent,
  getLiveProgression,
  type LiveProgressPoint,
} from "../reporting";

interface FundChartProps {
  report: PublicFundReportV2;
}

interface PositionedPoint extends LiveProgressPoint {
  x: number;
  y: number;
}

const width = 960;
const height = 340;
const padding = { top: 36, right: 28, bottom: 48, left: 72 };

export function FundChart({ report }: FundChartProps) {
  const progression = getLiveProgression(report);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  if (progression.length === 0) {
    return (
      <div
        aria-label="Fund progression has no completed live months"
        className="chart-frame chart-frame-empty"
        role="img"
      />
    );
  }

  const values = progression.map((point) => point.closingNav);
  const minimum = Math.floor((Math.min(...values) - 20) / 20) * 20;
  const maximum = Math.ceil((Math.max(...values) + 20) / 20) * 20;
  const range = Math.max(maximum - minimum, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const points: PositionedPoint[] = progression.map((point, index) => ({
    ...point,
    x: padding.left + (index / Math.max(progression.length - 1, 1)) * plotWidth,
    y: padding.top + ((maximum - point.closingNav) / range) * plotHeight,
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const activeIndex = focusedIndex ?? hoveredIndex ?? pinnedIndex;
  const activePoint = activeIndex === null ? null : (points[activeIndex] ?? null);

  return (
    <div aria-label="Live fund value history" className="chart-frame" role="region">
      <div className="chart-canvas">
        <svg
          aria-labelledby="fund-chart-title fund-chart-description"
          className="fund-chart"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <title id="fund-chart-title">Live fund value since inception</title>
          <desc id="fund-chart-description">
            Month-end net asset values beginning at {formatCurrency(report.startingNav)}.
          </desc>
          {[maximum, minimum + range / 2, minimum].map((guide) => {
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
                <text className="chart-axis-label" x={padding.left - 14} y={y + 4} textAnchor="end">
                  {formatCurrency(guide)}
                </text>
              </g>
            );
          })}
          <path className="chart-line" d={path} />
          {points.map((point) => (
            <text
              className="chart-axis-label"
              key={point.label}
              textAnchor="middle"
              x={point.x}
              y={height - 18}
            >
              {point.label === "Inception" ? "Start" : point.period.slice(5)}
            </text>
          ))}
        </svg>

        {points.map((point, index) => (
          <button
            aria-label={`${point.label}: ${formatCurrency(point.closingNav)}, ${formatPercent(point.cumulativeReturnPercent)} cumulative return`}
            className={`chart-point${activeIndex === index ? " chart-point-active" : ""}`}
            key={`${point.period}-${index}`}
            onBlur={() => setFocusedIndex(null)}
            onClick={() => setPinnedIndex(pinnedIndex === index ? null : index)}
            onFocus={() => setFocusedIndex(index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setPinnedIndex(pinnedIndex === index ? null : index);
              }
            }}
            onPointerDown={() => setPinnedIndex(index)}
            onPointerEnter={() => setHoveredIndex(index)}
            onPointerLeave={() => setHoveredIndex(null)}
            style={{ left: `${(point.x / width) * 100}%`, top: `${(point.y / height) * 100}%` }}
            type="button"
          />
        ))}

        {activePoint ? (
          <div
            aria-live="polite"
            className="chart-tooltip"
            style={{
              left: `${Math.min(86, Math.max(14, (activePoint.x / width) * 100))}%`,
              top: `${Math.max(4, (activePoint.y / height) * 100 - 27)}%`,
            }}
          >
            <span>{activePoint.label}</span>
            <strong>{formatCurrency(activePoint.closingNav)}</strong>
            <small>{formatPercent(activePoint.cumulativeReturnPercent)} cumulative</small>
          </div>
        ) : null}
      </div>
    </div>
  );
}
