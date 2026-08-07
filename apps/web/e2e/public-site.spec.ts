// This file checks the built public experience on desktop and mobile without exposing private data.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("overview exposes fund facts without browser-side API requests", async ({ page }) => {
  const apiRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Casus Strategies" })).toBeVisible();
  await expect(page.getByText("AI-native event driven")).toBeVisible();
  await expect(page.getByText("Awaiting first month close")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Fund progression has no completed live months" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /cumulative return/i })).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reports contains exactly the rolling six minimal tiles", async ({ page }) => {
  await page.goto("/reports");

  const reports = page.getByTestId("monthly-report");
  await expect(reports).toHaveCount(6);
  await expect(reports.first()).toContainText("February");
  await expect(reports.first()).toContainText("-0.5%");
  await expect(reports.last()).toContainText("July");
  await expect(reports.last()).toContainText("+1.5%");
  await expect(page.getByText(/realized P&L/i)).toHaveCount(0);
  await expect(page.getByText(/trade count/i)).toHaveCount(0);
});

test("methodology shows five sectors and high-level hedging", async ({ page }) => {
  await page.goto("/methodology");

  await expect(page.getByText("Weather", { exact: true })).toBeVisible();
  await expect(page.getByText("Economics", { exact: true })).toBeVisible();
  await expect(page.getByText("Politics and public policy", { exact: true })).toBeVisible();
  await expect(page.getByText("Legal and regulatory", { exact: true })).toBeVisible();
  await expect(page.getByText("Corporate events", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Hedging is part of the decision/i }),
  ).toBeVisible();
});

test("all three routes fit and remain usable on a narrow screen", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await page.getByRole("link", { name: "Methodology" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Methodology" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("public routes have no serious automated accessibility violations", async ({ page }) => {
  for (const route of ["/", "/reports", "/methodology"]) {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(serious).toEqual([]);
  }
});

test("built public assets contain no secrets, private records, or removed notices", async ({
  page,
}) => {
  await page.goto("/");
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).src));
  const source = (
    await Promise.all(scripts.map(async (script) => (await page.request.get(script)).text()))
  ).join("\n");
  const publicCopy = `${await page.locator("body").innerText()}\n${source}`;

  expect(source).not.toMatch(
    /PREDARENA_API_KEY|GROQ_API_KEY|GITHUB_REPORTS_TOKEN|CONGRESS_API_KEY|FEC_API_KEY/,
  );
  expect(source).not.toMatch(/trade_intents|risk_decisions|daily_metrics|agent prompts/i);
  expect(publicCopy).not.toMatch(
    /paper trading|shadow mode|illustrative preview|independent paper|version one/i,
  );
});
