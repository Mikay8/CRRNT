import { test, expect } from "@playwright/test";

test.describe("forgot password", () => {
  test("submitting an email shows a generic success message (no enumeration)", async ({
    page,
  }) => {
    await page.goto("/auth/forgot-password");
    await page.getByPlaceholder("you@example.com").fill("nobody-at-all@example.com");
    await page.getByText("Send reset link", { exact: true }).click();
    // Backend always returns success to avoid leaking which emails are registered.
    await expect(page.getByText("Check your inbox")).toBeVisible({ timeout: 10_000 });
  });
});
