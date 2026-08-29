import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Registers a fresh user and returns their email. Leaves the page on /onboarding. */
export async function registerNewUser(page: Page): Promise<string> {
  const email = `pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("At least 6 characters").fill("password123");
  await page.getByPlaceholder("Re-enter password").fill("password123");
  await page.getByText("Create account").click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
  return email;
}

/** Registers a user, dismisses the privacy screen, then hits "Skip" on every
 * quiz step (skip always advances regardless of validation) until the app
 * leaves /onboarding and lands on the feed. */
export async function registerAndCompleteOnboarding(page: Page): Promise<string> {
  const email = await registerNewUser(page);
  await page.getByText("I understand, continue").click();

  for (let i = 0; i < 8; i++) {
    if (!(await page.getByText("Skip", { exact: true }).isVisible().catch(() => false))) {
      break;
    }
    await page.getByText("Skip", { exact: true }).click();
    await page.waitForTimeout(150);
  }

  await expect(page).not.toHaveURL(/\/onboarding$/, { timeout: 15_000 });
  return email;
}
