import { fundReport } from "../data/fund-report";
import { formatPercent, formatPeriod, getLatestMonthlyReturns } from "../reporting";

export function ReportsPage() {
  const reports = getLatestMonthlyReturns(fundReport);
  const years = [...new Set(reports.map((report) => report.period.slice(0, 4)))];
  const dataStatus =
    fundReport.status === "official"
      ? "Official PredArena paper results"
      : "Illustrative preview. Shadow mode submits no paper orders and has no official record";

  return (
    <div className="content-width page-content">
      <header className="page-intro">
        <div className="eyebrow">Performance archive</div>
        <h1>Monthly reports</h1>
        <p>
          Six completed month-end returns, calculated from the paper portfolio’s official closing
          NAV.
        </p>
        <p className="data-status">{dataStatus}</p>
      </header>

      <div className="year-groups">
        {years.map((year) => (
          <section className="year-group" key={year} aria-labelledby={`year-${year}`}>
            <h2 id={`year-${year}`}>{year}</h2>
            <div className="report-grid">
              {reports
                .filter((report) => report.period.startsWith(year))
                .map((report) => {
                  const isPositive = report.returnPercent >= 0;

                  return (
                    <article
                      className="report-tile"
                      data-testid="monthly-report"
                      key={report.period}
                    >
                      <time dateTime={report.period}>{formatPeriod(report.period, true)}</time>
                      <strong className={isPositive ? "value-positive" : "value-negative"}>
                        {formatPercent(report.returnPercent)}
                      </strong>
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
