import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Firebaseに登録されたバケットだけを対象にする。ビルド用GCSバケットには触れない。 */
export async function deployRules({ project, apply = false, root = process.cwd(), command = execFileSync, request = fetch }) {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project ?? '')) throw new Error('PROJECT_IDを確認してください');
  const number = command('gcloud', ['projects', 'describe', project, '--format=value(projectNumber)'], { encoding: 'utf8' }).trim();
  if (!/^\d+$/.test(number)) throw new Error('プロジェクト番号を確認できません');
  const token = command('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  if (!token) throw new Error('配備用の認証が必要です');
  const buckets = new Set(), pages = new Set();
  let page = '';
  do {
    if (pages.has(page) || pages.size >= 100) throw new Error('Storage一覧のページを確認できません');
    pages.add(page);
    const url = new URL(`https://firebasestorage.googleapis.com/v1beta/projects/${number}/buckets`);
    if (page) url.searchParams.set('pageToken', page);
    const response = await request(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Storage一覧を取得できません。配備用アカウントの権限とAPI設定を確認してください');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.buckets !== undefined && !Array.isArray(data.buckets))) throw new Error('Storage一覧の形式を確認できません');
    for (const item of data.buckets ?? []) {
      const match = typeof item?.name === 'string' && item.name.match(/^projects\/(\d+)\/buckets\/([a-z0-9][a-z0-9._-]{1,220}[a-z0-9])$/);
      if (!match || match[1] !== number) throw new Error('Storage一覧に対象外の保存先があります');
      buckets.add(match[2]);
    }
    if (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string') throw new Error('Storage一覧のページを確認できません');
    page = data.nextPageToken ?? '';
  } while (page);

  const config = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
  if (!config.storage?.rules || Array.isArray(config.storage)) throw new Error('Storage Rules設定を確認してください');
  if (!apply) { console.info(`Rules配備計画: Firestore / Firebase Storage ${buckets.size}件（変更なし）`); return; }
  const directory = mkdtempSync(join(root, '.rules-deploy-'));
  try {
    const file = join(directory, 'firebase.json');
    // CLIが一時設定の場所を基準に解決するため、Rulesと索引は元のcheckoutの絶対パスにする。
    writeFileSync(file, JSON.stringify({
      firestore: { ...config.firestore, rules: resolve(root, config.firestore.rules), indexes: resolve(root, config.firestore.indexes) },
      storage: [...buckets].map((bucket) => ({ bucket, rules: resolve(root, config.storage.rules) })),
    }));
    const only = buckets.size ? 'firestore,storage' : 'firestore';
    command(join(root, 'firebase/node_modules/.bin/firebase'), ['deploy', '--only', only, '--config', file, '--project', project, '--non-interactive'], { cwd: root, stdio: 'inherit' });
    console.info(`Rules配備: Firestore / Firebase Storage ${buckets.size}件${buckets.size ? '' : '（一覧が空のため対象なし）'}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2] ?? '--plan';
  if (!['--plan', '--apply'].includes(mode) || process.argv.length > 3) throw new Error('--planまたは--applyを指定してください');
  deployRules({ project: process.env.PROJECT_ID, apply: mode === '--apply' }).catch(() => {
    console.error('Rulesの配備に失敗しました。Storage一覧の権限・対象と配備ログを確認してください。');
    process.exitCode = 1;
  });
}
