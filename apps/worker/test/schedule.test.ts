import { describe, expect, it } from "vitest";

import { getScheduledWindow } from "../src/schedule";

describe("getScheduledWindow", () => {
  it("recognizes 8 AM New York during daylight saving time", () => {
    const window = getScheduledWindow(new Date("2026-08-07T12:00:00.000Z"));

    expect(window).toEqual({
      date: "2026-08-07",
      hour: 8,
      runKey: "research:2026-08-07:08",
      isMorningSelection: true,
    });
  });

  it("recognizes 8 AM New York during standard time", () => {
    const window = getScheduledWindow(new Date("2026-01-07T13:00:00.000Z"));

    expect(window?.hour).toBe(8);
    expect(window?.date).toBe("2026-01-07");
  });

  it("does no research outside the four approved windows", () => {
    expect(getScheduledWindow(new Date("2026-08-07T13:00:00.000Z"))).toBeNull();
  });
});
