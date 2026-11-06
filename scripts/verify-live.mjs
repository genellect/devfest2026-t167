// 明示実行時だけ、架空の意見と無音PCMで実Vertexを検証する。エミュレータや本番DBに書き込まない。
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { vertexGemini } from '../api/src/gemini.ts';
import { readGoogleCredentials } from '../api/src/google-auth.ts';
const started = performance.now();
const report = { source: 'gemini', project: process.env.VERTEX_PROJECT, model: process.env.GEMINI_MODEL, text: 'not_run', audio: 'not_run' };
try {
  const { VERTEX_PROJECT, VERTEX_LOCATION, GEMINI_MODEL } = process.env;
  if (!VERTEX_PROJECT || !VERTEX_LOCATION || !GEMINI_MODEL) throw new Error('config');
  const gemini = vertexGemini(VERTEX_PROJECT, VERTEX_LOCATION, GEMINI_MODEL, readGoogleCredentials(process.env));
  const points = await gemini.findPoints(['架空の授業ではAIの利用を申告する'], ['AIを使ったら申告しよう']);
  if (!Array.isArray(points)) throw new Error('text');
  report.text = 'passed';
  // 1秒・16kHz・16bit mono。個人の録音を使わない。
  const audio = Buffer.alloc(44 + 32_000); audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(16_000, 24);
  audio.writeUInt32LE(32_000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(32_000, 40);
  await gemini.analyzeDiscussion({ audio, mimeType: 'audio/wav', durationSec: 1, theme: '架空の接続確認' });
  report.audio = 'passed';
} catch { report.error = 'live_verification_failed'; process.exitCode = 1; }
finally {
  report.elapsedMs = Math.round(performance.now() - started);
  mkdirSync('.local-data', { recursive: true });
  writeFileSync('.local-data/live-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
