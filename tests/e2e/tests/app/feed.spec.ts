import { test, expect } from "@playwright/test";
import { registerAndCompleteOnboarding } from "./helpers";

test.describe("feed screen", () => {
  test("guest can view the feed without signing in", async ({ page }) => {
    await page.goto("/login");
    await page.getByText("Browse without an account").click();
    await expect(page.getByAltText("CRRNT")).toBeVisible({ timeout: 10_000 });
  });

  test("logged-in user reaches the feed after onboarding, tab bar visible", async ({
    page,
  }) => {
    await registerAndCompleteOnboarding(page);
    await expect(page.getByAltText("CRRNT")).toBeVisible({ timeout: 10_000 });
    // Tab bar is hidden for guests, shown once a real user session exists.
    await expect(page.getByText("Feed")).toBeVisible();
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(page.getByText("Settings")).toBeVisible();
  });
});
