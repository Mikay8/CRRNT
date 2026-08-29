import { test, expect } from "@playwright/test";

test.describe("onboarding flow", () => {
  test("privacy screen leads directly into the quiz, no paywall", async ({
    page,
  }) => {
    const email = `pw-onboarding-${Date.now()}@example.com`;
    await page.goto("/register");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("At least 6 characters").fill("password123");
    await page.getByPlaceholder("Re-enter password").fill("password123");
    await page.getByText("Create account").click();

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
    await expect(page.getByText("Your data & privacy")).toBeVisible();

    await page.getByText("I understand, continue").click();

    // First quiz step — proves we skipped straight past the old paywall phase.
    await expect(page.getByText("What do you do for work?")).toBeVisible({
      timeout: 10_000,
    });
  });
});
