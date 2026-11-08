// docs/architecture.html を docs/architecture.png に描き出す（README の構成図）。
// 使い方: node scripts/render-architecture.cjs   （Playwright の Chromium を使う。PW_CHROMIUM_PATH があればそれを使う）
const path = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'web')] }));
(async () => {
  const root = path.join(__dirname, '..');
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 810 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(root, 'docs', 'architecture.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, 'docs', 'architecture.png'), fullPage: true });
  await browser.close();
  console.log('docs/architecture.png を書き出しました');
})().catch((e) => { console.error(e); process.exit(1); });
