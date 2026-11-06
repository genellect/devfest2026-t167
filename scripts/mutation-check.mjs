// 既存の純粋関数の境界を意図的に壊し、テストが検出するかを一時ディレクトリだけで確認する。
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..'), temp = mkdtempSync(join(tmpdir(), 't167-mutations-'));
const original = readFileSync(join(root, 'api/src/policy.ts'), 'utf8');
const mutations = [
  ["phase !== 'closed'", 'true'], ["status !== 'done'", 'true'],
  ['submitted >= total', 'submitted > total'], ['Number.isInteger(group)', 'true'],
  ['counts.set(uid, (counts.get(uid) ?? 0) + 1)', 'counts.set(uid, 1)'],
];
try {
  mkdirSync(join(temp, 'src')); mkdirSync(join(temp, 'test/unit'), { recursive: true });
  symlinkSync(join(root, 'api/node_modules'), join(temp, 'node_modules'), 'dir');
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
  copyFileSync(join(root, 'api/test/unit/policy.test.ts'), join(temp, 'test/unit/policy.test.ts'));
  const run = (code) => {
    writeFileSync(join(temp, 'src/policy.ts'), code);
    const result = spawnSync(process.execPath, [join(root, 'api/node_modules/vitest/vitest.mjs'), 'run', 'test/unit/policy.test.ts'], { cwd: temp, encoding: 'utf8', timeout: 30_000 });
    if (result.error) throw result.error;
    return result;
  };
  const baseline = run(original);
  if (baseline.status !== 0) throw new Error(`基準テストが失敗しました: ${baseline.stdout} ${baseline.stderr}`);
  let detected = 0;
  for (const [before, after] of mutations) {
    if (!original.includes(before)) throw new Error('変異箇所がありません');
    const result = run(original.replace(before, after));
    if (result.status === 1 && /failed/.test(result.stdout + result.stderr)) detected++;
  }
  console.log(`mutation: ${detected}/${mutations.length} 件の境界破壊を検出（純粋な進行規則のみ）`);
  if (detected !== mutations.length) process.exitCode = 1;
} finally { rmSync(temp, { recursive: true, force: true }); }
