// This file verifies the public routes and future live-chart interaction without using a network API.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { FundChart } from "./components/FundChart";
import { fundReport, type PublicFundReportV2 } from "./data/fund-report";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("public website", () => {
  it("shows fund facts and an empty live chart before the first close", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Casus Strategies" })).toBeInTheDocument();
    expect(screen.getByText("AI-native event driven")).toBeInTheDocument();
    expect(screen.getByText("Awaiting first month close")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Fund progression has no completed live months" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cumulative return/i })).not.toBeInTheDocument();
  });

  it("shows exactly six minimal monthly return tiles", () => {
    window.history.pushState({}, "", "/reports");
    render(<App />);

    expect(screen.getAllByTestId("monthly-report")).toHaveLength(6);
    expect(screen.getByText("-0.5%")).toBeInTheDocument();
    expect(screen.getByText("+1.5%")).toBeInTheDocument();
    expect(screen.queryByText(/realized P&L/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/trade count/i)).not.toBeInTheDocument();
  });

  it("reveals month, NAV, and cumulative return from mouse and keyboard input", () => {
    const report: PublicFundReportV2 = {
      ...fundReport,
      liveInceptionDate: "2026-08-01",
      liveMonths: [{ period: "2026-08", closingNav: 1_010 }],
    };
    render(<FundChart report={report} />);
    const augustPoint = screen.getByRole("button", { name: /August 2026.*\$1,010.*\+1.0%/i });

    fireEvent.pointerEnter(augustPoint);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getAllByText("$1,010")).toHaveLength(2);

    fireEvent.pointerLeave(augustPoint);
    fireEvent.focus(augustPoint);
    expect(screen.getByText("+1.0% cumulative")).toBeInTheDocument();

    fireEvent.keyDown(augustPoint, { key: "Enter" });
    fireEvent.blur(augustPoint);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
  });
});
