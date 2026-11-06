import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waitForApi } from '../demo/wait-for-api.mjs';

test('接続失敗とHTTP失敗の後も待ち、APIの正常応答でWeb起動へ進む', async () => {
  let calls = 0, waits = 0;
  await waitForApi({ request: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8081/health');
    assert.ok(options.signal);
    calls++;
    if (calls === 1) throw new Error('starting');
    return new Response('', { status: calls === 2 ? 503 : 200 });
  }, wait: async (ms) => { assert.equal(ms, 250); waits++; } });
  assert.equal(calls, 3); assert.equal(waits, 2);
});

test('APIが起動しない場合は有限回で失敗し、成功にしない', async () => {
  let calls = 0;
  await assert.rejects(waitForApi({ request: async () => { calls++; throw new Error('offline'); }, wait: async () => {} }));
  assert.equal(calls, 120);
});

test('API確認前からcleanupを設置し、確認後だけNextを起動する', () => {
  const start = readFileSync(new URL('../demo/start.sh', import.meta.url), 'utf8');
  assert.ok(start.indexOf('trap cleanup') < start.indexOf('node /app/demo/wait-for-api.mjs'));
  assert.ok(start.indexOf('node /app/demo/wait-for-api.mjs') < start.indexOf('next start'));
  assert.match(start, /web_pid=''/);
  assert.match(readFileSync(new URL('../demo/Dockerfile', import.meta.url), 'utf8'), /COPY demo\/start.sh demo\/wait-for-api.mjs \.\/demo\//);
});
