import {defineConfig} from '@playwright/test';
import base from './playwright.config';
if(process.env.T167_REAL_GEMINI !== '1' || !process.env.T167_PUBLIC_AUDIO_FILE) throw new Error('実Gemini試験はT167_REAL_GEMINI=1と公開音声T167_PUBLIC_AUDIO_FILEを明示してください');
export default defineConfig({
  ...base,
  testDir:'real-e2e', testMatch:'public-audio.spec.ts', globalSetup:'./e2e/setup.ts', timeout:180000, retries:0,
  projects:[{name:'public-audio-chromium',use:{browserName:'chromium',viewport:{width:393,height:852},isMobile:true,hasTouch:true,launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${process.env.T167_PUBLIC_AUDIO_FILE}`]}}}],
});
