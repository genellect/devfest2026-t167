// PWAとブラウザのアイコンを、共通のSVGから描画する。
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../web/package.json', import.meta.url))('@playwright/test');
const icons = new URL('../web/public/icons/', import.meta.url);
const svg = await readFile(new URL('topos.svg', icons), 'utf8');
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png'], [32, null]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    const png = await page.screenshot({ type: 'png' });
    if (name) await writeFile(new URL(name, icons), png);
    else {
      // ICOの1フレームとしてPNGを格納する（32px、32bit）。
      const header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
      header[6] = header[7] = size;
      header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
      header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
      await writeFile(new URL('../web/src/app/favicon.ico', import.meta.url), Buffer.concat([header, png]));
    }
  }
} finally { await browser.close(); }
