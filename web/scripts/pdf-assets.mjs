// PDFを第三者のCDNへ送らず、lockfileと同じ版のworker・文字マップ・フォントを配信する。
import { cp, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), pkg = new URL('node_modules/pdfjs-dist/', root);
const { version } = JSON.parse(await readFile(new URL('package.json', pkg), 'utf8'));
const target = new URL(`public/pdfjs-${version}/`, root); await mkdir(target, { recursive: true });
await cp(fileURLToPath(new URL('build/pdf.worker.min.mjs', pkg)), fileURLToPath(new URL('pdf.worker.min.mjs', target)));
await cp(fileURLToPath(new URL('LICENSE', pkg)), fileURLToPath(new URL('LICENSE', target)));
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) await cp(fileURLToPath(new URL(`${folder}/`, pkg)), fileURLToPath(new URL(`${folder}/`, target)), { recursive: true });
