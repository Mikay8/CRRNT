import { test, expect, devices } from "@playwright/test";

test.use({ ...devices["iPhone 13"], browserName: "chromium" });

test.describe("bottom tab bar", () => {
  test("sliding a finger along the bar switches to the tab it's released on", async ({ page }) => {
    await page.goto("/");
    const feed = page.getByRole("tab", { name: "Feed" });
    const saved = page.getByRole("tab", { name: "Saved" });
    await expect(feed).toBeVisible({ timeout: 15_000 });

    const from = (await feed.boundingBox())!;
    const to = (await saved.boundingBox())!;
    const y = from.y + from.height / 2;
    await page.mouse.move(from.x + from.width / 2, y);
    await page.mouse.down();
    // Slide in small steps, like a finger, and pause midway over Search.
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const x = from.x + from.width / 2 + ((to.x + to.width / 2 - (from.x + from.width / 2)) * i) / steps;
      await page.mouse.move(x, y);
      await page.waitForTimeout(16);
      if (i === steps / 2) await page.screenshot({ path: "test-results/tab-scrub-mid.png" });
    }
    await page.mouse.up();

    await expect(page).toHaveURL(/\/saved$/, { timeout: 5_000 });
  });

  test("a plain tap still switches tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: "Feed" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tab", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search$/, { timeout: 5_000 });
  });
});
