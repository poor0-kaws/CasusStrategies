import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("overview exposes the public fund record without a private API", async ({ page }) => {
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
  await expect(page.getByRole("img", { name: /fund value since inception/i })).toBeVisible();
  await expect(page.getByText(/No real money is traded or managed/).first()).toBeVisible();
  await expect(page.getByText(/Illustrative preview/)).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("reports contains exactly the latest six minimal tiles", async ({ page }) => {
  await page.goto("/reports");

  const reports = page.getByTestId("monthly-report");
  await expect(reports).toHaveCount(6);
  await expect(reports.first()).toContainText("February 2026");
  await expect(reports.last()).toContainText("July 2026");
  await expect(page.getByText(/realized P&L/i)).toHaveCount(0);
  await expect(page.getByText(/trade count/i)).toHaveCount(0);
});

test("all three routes remain usable on a narrow screen", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Monthly reports" })).toBeVisible();
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

test("built JavaScript contains no known secret or private-record labels", async ({ page }) => {
  await page.goto("/");
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).src));
  const source = (
    await Promise.all(scripts.map(async (script) => (await page.request.get(script)).text()))
  ).join("\n");

  expect(source).not.toMatch(/PREDARENA_API_KEY|GROQ_API_KEY|GITHUB_REPORTS_TOKEN/);
  expect(source).not.toMatch(/trade_intents|risk_decisions|daily_metrics/);
});
