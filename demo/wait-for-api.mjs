import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** APIの応答を待ってからWebを開始する。失敗時は起動スクリプトがAPIも停止する。 */
export async function waitForApi({ request = fetch, wait = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await request('http://127.0.0.1:8081/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* 起動中の接続失敗も回数上限まで待つ。生の例外は記録しない。 */ }
    if (attempt < 119) await wait(250);
  }
  throw new Error('APIの起動を確認できませんでした');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  waitForApi().catch(() => { console.error('APIの起動を確認できませんでした'); process.exitCode = 1; });
}
