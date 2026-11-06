import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { test } from 'node:test';

const run = (offset) => spawnSync('bash', ['scripts/dev.sh', 'check', '--quick'], {
  encoding: 'utf8', timeout: 10_000,
  env: { ...process.env, T167_TEST_PORT_OFFSET: offset },
});

test('不正なオフセットは検査やサーバーの起動前に拒否する', () => {
  for (const offset of ['-1', '40001', '1.5', 'invalid', '000001']) {
    const result = run(offset);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NG:/);
    assert.doesNotMatch(result.stdout, /静的検査/);
  }
});

test('使用中のポートを検査に流用せず、既存のサーバーを停止しない', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(35000, '127.0.0.1', resolve);
  });
  try {
    const result = run('32000');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ポート 35000 は使用中/);
    assert.doesNotMatch(result.stdout, /静的検査/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
