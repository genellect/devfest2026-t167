import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  testMatch: /drive-materials\.spec\.ts/,
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 960 } } },
    { name: "safari-phone", use: { ...devices["iPhone 16"] } },
  ],
});
