import { test, expect } from "@playwright/test";

const ADMIN_USER = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? "";

test.use({
  httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
});

test.describe("admin dashboard", () => {
  test.skip(!ADMIN_PASS, "ADMIN_PASSWORD env var not set");

  test("renders without a RevenueCat/tier stat card", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Total Stories")).toBeVisible();
    await expect(page.getByText("Total Users")).toBeVisible();
    // These fields were removed when RevenueCat/tiers were stripped out.
    await expect(page.getByText("Active Subscriptions")).toHaveCount(0);
    await expect(page.getByText("RevenueCat", { exact: false })).toHaveCount(0);
  });

  test("stories page loads with no tier filter and no tier column", async ({
    page,
  }) => {
    await page.goto("/admin/stories");
    await expect(page.getByRole("heading", { name: "Stories" })).toBeVisible();
    await expect(page.getByText("All tiers")).toHaveCount(0);
    await expect(page.locator("th", { hasText: "Tier" })).toHaveCount(0);
  });

  test("users page loads with no tier tabs or RC id column", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(page.getByText("RC ID")).toHaveCount(0);
    await expect(page.locator("th", { hasText: "Tier" })).toHaveCount(0);
  });

  test("settings page loads, shows a single feed limit, and no Supabase/RC secrets", async ({
    page,
  }) => {
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("DATABASE_URL")).toBeVisible();
    await expect(page.getByText("JWT_SECRET")).toBeVisible();
    await expect(page.getByText("SUPABASE_URL")).toHaveCount(0);
    await expect(page.getByText("REVENUECAT_WEBHOOK_SECRET")).toHaveCount(0);
    // Feed limits collapsed to a single "daily" slider (was free/paid).
    await expect(page.locator('input[name="daily_limit"]')).toBeVisible();
    await expect(page.locator('input[name="paid_limit"]')).toHaveCount(0);
  });

  test("breaking news page loads", async ({ page }) => {
    await page.goto("/admin/breaking");
    await expect(page.getByRole("heading", { name: "Breaking News" })).toBeVisible();
  });
});
