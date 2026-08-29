import { test, expect } from "@playwright/test";
import { registerAndCompleteOnboarding } from "./helpers";

test.describe("settings screen", () => {
  test("guest visiting /settings is redirected to /login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("logged-in user sees account email and no subscription UI", async ({
    page,
  }) => {
    const email = await registerAndCompleteOnboarding(page);
    // expo-router tabs are client-side — navigating via a fresh page.goto()
    // to a nested tab route lands back on the default tab, so click instead.
    await page.getByRole("tab", { name: /Settings/ }).click();

    await expect(page.getByText(email)).toBeVisible();

    // RevenueCat/tier UI was removed entirely from this screen.
    await expect(page.getByText("Subscription")).toHaveCount(0);
    await expect(page.getByText("Upgrade", { exact: true })).toHaveCount(0);
    await expect(page.getByText("CRRNT Pro")).toHaveCount(0);
    await expect(page.getByText("Restore purchases")).toHaveCount(0);

    // Personalization + appearance sections should still be present.
    await expect(page.getByText("Personalization")).toBeVisible();
    await expect(page.getByText("Appearance")).toBeVisible();
  });

  test("sign out returns to /login", async ({ page }) => {
    await registerAndCompleteOnboarding(page);
    await page.getByRole("tab", { name: /Settings/ }).click();
    await page.getByText("Sign out", { exact: true }).first().click();

    // The confirmation dialog has three "Sign out" text nodes on screen at
    // once (row label, dialog title, dialog button) — DOM order between them
    // isn't reliable, so find the destructive-red one by its computed color
    // rather than assuming a position.
    const candidates = page.getByText("Sign out", { exact: true });
    await expect(candidates).toHaveCount(3);
    let clicked = false;
    for (let i = 0; i < 3; i++) {
      const candidate = candidates.nth(i);
      const [r, g, b] = await candidate.evaluate((n) => {
        const m = getComputedStyle(n).color.match(/\d+/g)!;
        return m.map(Number);
      });
      const isRed = r > 180 && r - g > 60 && r - b > 60;
      if (isRed) {
        await candidate.click();
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);

    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  });
});
