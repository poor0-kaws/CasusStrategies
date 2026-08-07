import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("public website", () => {
  it("shows the fund value chart and paper-trading disclosure", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Casus Strategies" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Simulated fund value since inception/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/No real money is traded/)).not.toHaveLength(0);
    expect(screen.getByText("Illustrative NAV")).toBeInTheDocument();
  });

  it("shows six monthly tiles without private performance details", () => {
    window.history.pushState({}, "", "/reports");
    render(<App />);

    expect(screen.getAllByTestId("monthly-report")).toHaveLength(6);
    expect(screen.getByText(/Shadow mode submits no paper orders/)).toBeInTheDocument();
    expect(screen.queryByText(/realized P&L/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/trade count/i)).not.toBeInTheDocument();
  });
});
