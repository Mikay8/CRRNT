import { test, expect } from "@playwright/test";
import { registerAndCompleteOnboarding } from "./helpers";

test.describe("saved screen", () => {
  test("renders the saved stories tab with an empty state on a fresh account", async ({
    page,
  }) => {
    await registerAndCompleteOnboarding(page);
    // expo-router tabs are client-side — navigating via a fresh page.goto()
    // to a nested tab route lands back on the default tab, so click instead.
    await page.getByRole("tab", { name: /Saved/ }).click();
    await expect(page.getByText("0 stories you bookmarked")).toBeVisible();
  });
});
