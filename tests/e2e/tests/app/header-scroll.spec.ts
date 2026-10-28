import { test, expect, devices } from "@playwright/test";

// Phone-sized viewport so the app renders the mobile layout, not the desktop one.
test.use({ ...devices["iPhone 13"], browserName: "chromium" });

test.describe("feed header", () => {
  test("logo row scrolls out of view while the category tabs stay pinned", async ({ page }) => {
    await page.goto("/");
    const logo = page.getByAltText("CRRNT");
    await expect(logo).toBeVisible({ timeout: 15_000 });
    const allTab = page.getByRole("tab", { name: "All" });
    await expect(allTab).toBeVisible();
    // Wait for stories so there is something to scroll.
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: "test-results/header-before.png" });

    const tabsBefore = (await allTab.boundingBox())!;

    // Scroll the feed well past the header.
    await page.mouse.move(195, 500);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 150);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: "test-results/header-after.png" });

    // The logo must no longer be what's drawn at its own position: either it
    // has left the viewport or something opaque covers it.
    const logoShowing = await logo.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.height === 0) return false;
      const x = r.left + r.width / 2;
      const y = Math.max(r.top, 0) + Math.min(r.bottom, r.height) / 2;
      const hit = document.elementFromPoint(x, Math.max(1, y));
      return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    });
    expect(logoShowing, "CRRNT logo should be hidden after scrolling").toBe(false);

    // The category tabs stay on screen and move up into the logo's place.
    const tabsAfter = (await allTab.boundingBox())!;
    await expect(allTab).toBeInViewport();
    expect(tabsAfter.y).toBeLessThan(tabsBefore.y - 20);
  });

  test("mini player artwork is a circle", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Play story").first().click({ timeout: 15_000 });
    // On phone web the tap can also open the story page; come back to the feed.
    if (!(await page.getByRole("tab", { name: "All" }).isVisible())) await page.goBack();
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible({ timeout: 10_000 });
    const openPlayer = page.getByLabel("Open player");
    await expect(openPlayer).toBeInViewport({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/mini-player.png" });

    // The artwork is the first square box inside the mini bar's container.
    // The artwork sits at the bar's left edge: the square box whose left is
    // 8px inside the bar.
    const radiusRatio = await openPlayer.evaluate((el) => {
      const bar = el.parentElement!.parentElement!;
      const b = bar.getBoundingClientRect();
      for (const n of Array.from(bar.children) as HTMLElement[]) {
        const r = n.getBoundingClientRect();
        if (Math.abs(r.left - b.left - 8) < 2 && r.width > 30 && Math.abs(r.width - r.height) < 1) {
          return parseFloat(getComputedStyle(n).borderTopLeftRadius) / r.width;
        }
      }
      return -1;
    });
    expect(radiusRatio).toBeGreaterThanOrEqual(0.49);
  });
});

test.describe("feed header (desktop web)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("logo row tucks away on scroll, tabs stay, no search box in the header", async ({ page }) => {
    await page.goto("/");
    const logo = page.getByAltText("CRRNT");
    await expect(logo).toBeVisible({ timeout: 15_000 });
    const allTab = page.getByRole("tab", { name: "All" });
    await expect(allTab).toBeVisible();
    await expect(page.getByPlaceholder("Search stories, tickers, topics")).toHaveCount(0);
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: "test-results/desktop-before.png" });

    await page.mouse.move(640, 500);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/desktop-after.png" });

    const logoShowing = await logo.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.bottom <= 0) return false;
      let n: HTMLElement | null = el as HTMLElement;
      while (n) {
        if (parseFloat(getComputedStyle(n).opacity) < 0.05) return false;
        n = n.parentElement;
      }
      return true;
    });
    expect(logoShowing, "CRRNT logo should be hidden after scrolling").toBe(false);
    await expect(allTab).toBeInViewport();
  });
});
