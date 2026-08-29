import { defineConfig, devices } from "@playwright/test";

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL ?? "http://localhost:8080";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:8081";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],

  projects: [
    {
      name: "admin-portal",
      testMatch: /admin\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: ADMIN_BASE_URL,
        trace: "retain-on-failure",
      },
    },
    {
      name: "expo-web",
      testMatch: /app\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: APP_BASE_URL,
        trace: "retain-on-failure",
      },
    },
  ],
});
