import { defineConfig, devices } from "@playwright/test";

// エミュレータ（auth・firestore）が起動している前提。CI では firebase emulators:exec の中で実行する。
const emulatorEnv = {
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099",
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT ?? "demo-t167",
  GEMINI_MOCK: "1",
  PORT: process.env.T167_API_PORT ?? "8081",
};

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/setup.ts",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${process.env.T167_WEB_PORT ?? 3000}`,
    trace: "retain-on-failure",
    launchOptions: {
      // 録音の E2E で、本物のマイクの代わりに Chromium の擬似マイクを使い、許可の確認も省く
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      // ブラウザを別の場所に置いている環境では PW_CHROMIUM_PATH で指定する
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "npm --prefix ../api run start", url: `http://127.0.0.1:${emulatorEnv.PORT}/health`, env: emulatorEnv, reuseExistingServer: false },
    { command: `npm run start -- -H 127.0.0.1 -p ${process.env.T167_WEB_PORT ?? 3000}`, url: `http://127.0.0.1:${process.env.T167_WEB_PORT ?? 3000}`, reuseExistingServer: false },
  ],
});
