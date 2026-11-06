import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployRules } from '../infra/deploy-rules.mjs';

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 't167-rules-'));
  writeFileSync(join(root, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firebase/firestore.rules', indexes: 'firebase/firestore.indexes.json' }, storage: { rules: 'firebase/storage.rules' } }));
  const calls = [];
  const command = (file, args) => {
    if (file === 'gcloud') return args[0] === 'projects' ? '123\n' : 'test-credential'; // submit-allow: ダミー認証
    const config = JSON.parse(readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
    calls.push({ args, config });
  };
  try { await run({ root, project: 'demo-t167', apply: true, command, calls }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('計画モードでは一覧確認だけで配備しない', () => fixture(async (f) => {
  await deployRules({ ...f, apply: false, request: async () => reply({ buckets: [{ name: 'projects/123/buckets/first-bucket' }] }) });
  assert.equal(f.calls.length, 0);
}));

test('登録バケット全件をページ取得し、両Rulesを同じcheckoutから配備する', () => fixture(async (f) => {
  let count = 0;
  await deployRules({ ...f, request: async (url) => {
    count++;
    if (count === 1) return reply({ buckets: [{ name: 'projects/123/buckets/first-bucket' }], nextPageToken: 'next' });
    assert.equal(url.searchParams.get('pageToken'), 'next');
    return reply({ buckets: [{ name: 'projects/123/buckets/second-bucket' }] });
  } });
  assert.equal(count, 2);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf('--only') + 1], 'firestore,storage');
  assert.deepEqual(f.calls[0].config.storage.map((b) => b.bucket), ['first-bucket', 'second-bucket']);
  assert.ok(f.calls[0].config.storage.every((b) => b.rules === join(f.root, 'firebase/storage.rules')));
  assert.equal(f.calls[0].config.firestore.rules, join(f.root, 'firebase/firestore.rules'));
  assert.deepEqual(readdirSync(f.root), ['firebase.json']);
}));

test('登録バケットがないと確認できた場合だけStorageを省略し、新規作成しない', () => fixture(async (f) => {
  await deployRules({ ...f, request: async () => reply({}) });
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf('--only') + 1], 'firestore');
  assert.deepEqual(f.calls[0].config.storage, []);
}));

for (const status of [403, 404, 503]) test(`一覧取得HTTP ${status}で配備せず停止する`, () => fixture(async (f) => {
  await assert.rejects(deployRules({ ...f, request: async () => reply({}, status) }));
  assert.equal(f.calls.length, 0);
}));

test('通信失敗・壊れた一覧・別プロジェクト・繰り返しページを対象なしにしない', () => fixture(async (f) => {
  for (const request of [
    async () => { throw new Error('offline'); },
    async () => reply({ buckets: 'invalid' }),
    async () => reply({ buckets: [{ name: 'projects/999/buckets/another-project' }] }),
    async () => reply({ nextPageToken: 'repeat' }),
  ]) await assert.rejects(deployRules({ ...f, request }));
  assert.equal(f.calls.length, 0);
}));

test('CLI配備失敗を成功にせず、一時設定を削除する', () => fixture(async (f) => {
  const command = (file, args) => { if (file === 'gcloud') return f.command(file, args); throw new Error('deployment failed'); };
  await assert.rejects(deployRules({ ...f, command, request: async () => reply({ buckets: [{ name: 'projects/123/buckets/first-bucket' }] }) }));
  assert.deepEqual(readdirSync(f.root), ['firebase.json']);
}));
