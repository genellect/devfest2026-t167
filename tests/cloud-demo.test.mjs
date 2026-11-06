import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { teacherOptions, teacherAccess } from '../scripts/teacher-access.mjs';

const fixture = (patch = {}) => {
  const calls = [];
  const auth = {
    getUser: async (uid) => ({ uid, disabled: false, providerData: [{ providerId: 'google.com' }], customClaims: { retained: 'yes', teacher: true }, ...patch }),
    getUserByEmail: async (email) => { calls.push(['lookup']); if (email !== 'teacher@example.com') throw new Error('synthetic not found'); return { uid: 'by-email', disabled: false, providerData: [{ providerId: 'google.com' }], customClaims: {}, ...patch }; },
    setCustomUserClaims: async (uid, claims) => calls.push(['claims', uid, claims]),
    revokeRefreshTokens: async (uid) => calls.push(['revoke', uid]),
  };
  return { auth, calls };
};

test('プロジェクト・UID・操作を明示しない場合は拒否する', () => {
  for (const args of [[], ['--project', 'devfest2026-t167'], ['--project', 'devfest2026-t167', '--uid', 'synthetic', '--action', 'other']]) assert.throws(() => teacherOptions(args));
  assert.deepEqual({ ...teacherOptions(['--project', 'devfest2026-t167', '--uid', 'synthetic', '--action', 'inspect']) }, { project: 'devfest2026-t167', uid: 'synthetic', action: 'inspect' });
  assert.deepEqual({ ...teacherOptions(['--project', 'devfest2026-t167', '--email', 'teacher@example.com', '--action', 'grant']) }, { project: 'devfest2026-t167', email: 'teacher@example.com', action: 'grant' });
  // UIDとメールの両方、または不正なメールは拒否する
  for (const args of [['--project', 'devfest2026-t167', '--uid', 'synthetic', '--email', 'teacher@example.com', '--action', 'grant'], ['--project', 'devfest2026-t167', '--email', 'not-an-email', '--action', 'grant']]) assert.throws(() => teacherOptions(args));
});
test('メールアドレスで指定した教員にも、同じ条件で教師権限を付与する', async () => {
  const { auth, calls } = fixture();
  assert.deepEqual(await teacherAccess(auth, { email: 'teacher@example.com', action: 'grant' }), { teacher: true, changed: true, signInAgain: true });
  assert.deepEqual(calls, [['lookup'], ['claims', 'by-email', { teacher: true }], ['revoke', 'by-email']]);
  const missing = fixture();
  await assert.rejects(teacherAccess(missing.auth, { email: 'nobody@example.com', action: 'grant' }));
  assert.deepEqual(missing.calls, [['lookup']]);
});
test('inspectは認証情報と権限を変更しない', async () => {
  const { auth, calls } = fixture();
  assert.deepEqual(await teacherAccess(auth, { uid: 'synthetic', action: 'inspect' }), { teacher: true, googleLogin: true, disabled: false, changed: false });
  assert.deepEqual(calls, []);
});
test('教師付与は他のclaimを保持し、以前のトークンを失効させる', async () => {
  const { auth, calls } = fixture();
  await teacherAccess(auth, { uid: 'synthetic', action: 'grant' });
  assert.deepEqual(calls, [['claims', 'synthetic', { retained: 'yes', teacher: true }], ['revoke', 'synthetic']]);
});
test('教師解除ではteacherだけを削除し、以前のトークンを失効させる', async () => {
  const { auth, calls } = fixture();
  await teacherAccess(auth, { uid: 'synthetic', action: 'revoke' });
  assert.deepEqual(calls, [['claims', 'synthetic', { retained: 'yes' }], ['revoke', 'synthetic']]);
});
test('無効な利用者やGoogle未連携の利用者へ教師権限を付与しない', async () => {
  for (const patch of [{ disabled: true }, { providerData: [] }]) {
    const { auth, calls } = fixture(patch);
    await assert.rejects(teacherAccess(auth, { uid: 'synthetic', action: 'grant' }));
    assert.deepEqual(calls, []);
  }
});
test('ユーザーの確認に失敗した場合は書き込まない', async () => {
  const { auth, calls } = fixture();
  auth.getUser = async () => { throw new Error('synthetic lookup failure'); };
  await assert.rejects(teacherAccess(auth, { uid: 'synthetic', action: 'grant' }));
  assert.deepEqual(calls, []);
});
test('CLIの不正引数でも渡した内容をログに出さない', () => {
  const marker = 'synthetic-private-marker';
  const result = spawnSync(process.execPath, ['scripts/teacher-access.mjs', '--unknown', marker], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(!result.stderr.includes(marker));
});
test('Cloud Runには認証の読取権限だけを設定する（gcloudは偽物）', () => {
  const root = resolve(import.meta.dirname, '..'), temp = mkdtempSync(join(tmpdir(), 't167-demo-'));
  try {
    mkdirSync(join(temp, 'bin'));
    writeFileSync(join(temp, 'bin/gcloud'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$T167_GCLOUD_CALLS"\n', { mode: 0o755 });
    const log = join(temp, 'calls');
    const result = spawnSync('bash', ['infra/setup-project.sh'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: join(temp, 'bin') + ':' + process.env.PATH, T167_GCLOUD_CALLS: log } });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(log, 'utf8');
    assert.match(commands, /api-runtime@devfest2026-t167\.iam\.gserviceaccount\.com --role=roles\/firebaseauth\.viewer/);
    assert.doesNotMatch(commands, /roles\/(firebaseauth\.admin|owner|editor)/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
