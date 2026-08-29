import { test, expect } from "@playwright/test";

const ADMIN_USER = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? "";

test.describe("admin portal auth", () => {
  test("rejects unauthenticated access with a 401", async ({ page }) => {
    const response = await page.goto("/admin/dashboard");
    expect(response?.status()).toBe(401);
  });

  test("rejects wrong credentials", async ({ browser }) => {
    const context = await browser.newContext({
      httpCredentials: { username: ADMIN_USER, password: "definitely-wrong" },
    });
    const page = await context.newPage();
    const response = await page.goto("/admin/dashboard");
    expect(response?.status()).toBe(401);
    await context.close();
  });

  test("logs in with correct credentials and reaches the dashboard", async ({
    browser,
  }) => {
    test.skip(!ADMIN_PASS, "ADMIN_PASSWORD env var not set");
    const context = await browser.newContext({
      httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });
    const page = await context.newPage();
    const response = await page.goto("/admin/dashboard");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await context.close();
  });

  test("redirects /admin to /admin/dashboard", async ({ browser }) => {
    test.skip(!ADMIN_PASS, "ADMIN_PASSWORD env var not set");
    const context = await browser.newContext({
      httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await context.close();
  });
});
