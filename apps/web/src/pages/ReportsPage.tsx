// This file shows the rolling six-month return record with live months replacing historical months.

import { fundReport } from "../data/fund-report";
import { formatPercent, formatPeriod, getLatestMonthlyReturns } from "../reporting";

export function ReportsPage() {
  const reports = getLatestMonthlyReturns(fundReport);
  const years = [...new Set(reports.map((report) => report.period.slice(0, 4)))];

  return (
    <div className="content-width page-content">
      <header className="page-intro reports-intro">
        <p className="eyebrow">Monthly record</p>
        <h1>Reports</h1>
        <p>
          Historical model results establish the opening record. As each verified operating month
          closes, it enters this six-month window and replaces the oldest historical month.
        </p>
      </header>

      <div className="year-groups">
        {years.map((year) => (
          <section aria-labelledby={`year-${year}`} className="year-group" key={year}>
            <h2 id={`year-${year}`}>{year}</h2>
            <div className="report-grid">
              {reports
                .filter((report) => report.period.startsWith(year))
                .map((report) => (
                  <article className="report-tile" data-testid="monthly-report" key={report.period}>
                    <time dateTime={report.period}>{formatPeriod(report.period)}</time>
                    <span>{year}</span>
                    <strong
                      className={report.returnPercent < 0 ? "value-negative" : "value-positive"}
                    >
                      {formatPercent(report.returnPercent)}
                    </strong>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
