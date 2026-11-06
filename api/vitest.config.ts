import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/audio-worker.ts'], // 起動口はE2E、別Workerの内部は実音声テストで確認する
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 85, branches: 80, functions: 90, statements: 85 },
    },
  },
});
