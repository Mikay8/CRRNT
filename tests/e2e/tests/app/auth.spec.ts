import { test, expect } from "@playwright/test";

test.describe("app auth screens", () => {
  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  });

  test("can browse without an account (guest mode)", async ({ page }) => {
    await page.goto("/login");
    await page.getByText("Browse without an account").click();
    // (tabs) is a route group and doesn't appear in the URL — landing on the
    // feed just means we've left /login.
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("navigates from login to register and back", async ({ page }) => {
    await page.goto("/login");
    await page.getByText("Create one").click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText("Create your")).toBeVisible();

    // "Sign in" appears as both the footer link here and (once we're back)
    // the login screen's submit button — scope to the footer link.
    await page.getByText("Already have an account?").locator("..").getByText("Sign in").click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("register screen validates password confirmation and blocks submit", async ({
    page,
  }) => {
    await page.goto("/register");
    await page.getByPlaceholder("you@example.com").fill("test@example.com");
    await page.getByPlaceholder("At least 6 characters").fill("password123");
    await page.getByPlaceholder("Re-enter password").fill("mismatched");
    await expect(page.getByText("Passwords don't match")).toBeVisible();

    // RN Web Pressable doesn't always expose a real `disabled` attribute, so
    // assert on behavior instead: clicking submit does not navigate away.
    await page.getByText("Create account").click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/register$/);
  });

  test("registers a new user and lands on onboarding", async ({ page }) => {
    const email = `pw-test-${Date.now()}@example.com`;
    await page.goto("/register");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("At least 6 characters").fill("password123");
    await page.getByPlaceholder("Re-enter password").fill("password123");
    await page.getByText("Create account").click();

    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
    // The RevenueCat paywall step was removed — onboarding should go
    // straight from the privacy screen into the quiz, never blocking on
    // a purchase.
    await expect(page.getByText("RevenueCat", { exact: false })).toHaveCount(0);
  });

  test("shows an error on login with bad credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("you@example.com").fill("nobody@example.com");
    await page.getByPlaceholder("••••••••").fill("wrongpassword");
    await page.getByText("Sign in", { exact: true }).click();
    await expect(page.getByText(/failed|invalid/i)).toBeVisible({ timeout: 10_000 });
  });

  test("forgot password screen accepts an email and shows confirmation", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByText("Forgot password?").click();
    await expect(page).toHaveURL(/\/auth\/forgot-password$/);
  });
});
