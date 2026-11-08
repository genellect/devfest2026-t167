import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';
export default defineConfig(base, {
  testMatch:'classroom.spec.ts',
  projects:[
    {name:'classroom-chromium-phone',use:{...devices['Pixel 7']}},
    {name:'classroom-chromium-desktop',use:{browserName:'chromium',viewport:{width:1440,height:1000}}},
    {name:'classroom-webkit-tablet',use:{...devices['iPad (gen 7)'],launchOptions:{args:[]}}},
  ],
});
