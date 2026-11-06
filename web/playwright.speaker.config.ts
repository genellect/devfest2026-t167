import { defineConfig } from '@playwright/test';
import base from './playwright.config';
if (!process.env.SPEAKER_LIVE_TEST_WAV || !process.env.SPEAKER_EMBEDDING_MODEL || !process.env.SPEAKER_VAD_MODEL) throw new Error('実モデルと公開音声ファイルを指定してください');
export default defineConfig({
  ...base,
  testDir: 'real-e2e',
  timeout: process.env.T167_REAL_GEMINI === "1" ? 240_000 : 90_000,
  use: { ...base.use, launchOptions: { ...base.use?.launchOptions, args: [...(base.use?.launchOptions?.args ?? []), `--use-file-for-fake-audio-capture=${process.env.SPEAKER_LIVE_TEST_WAV}`] } },
});
