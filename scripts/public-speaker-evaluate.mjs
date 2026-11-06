// 取得済み公開人声を実モデルで評価する。音声・特徴を出力せず、集計だけを保存する。
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SpeakerWorker } from '../api/dist/voice-worker.js';
import { matchSpeaker } from '../api/dist/speaker-types.js';
const folder = resolve('.local-data/public-voices');
function pcm(data) {
  for (let at = 12; at < data.length;) {
    const size = data.readUInt32LE(at + 4);
    if (data.toString('ascii', at, at + 4) === 'data') return data.subarray(at + 8, at + 8 + size);
    at += 8 + size + size % 2;
  }
  throw new Error('invalid_wave');
}
const worker = new SpeakerWorker(process.env.SPEAKER_PYTHON ?? resolve('.local-data/speaker-venv/bin/python'), resolve('speech/worker.py'));
const profiles = [], report = [];
try {
  for (let i = 1; i <= 2; i++) {
    const audio = pcm(await readFile(resolve(folder, `speaker-${i}-enroll.wav`)));
    const result = await worker.analyze(audio); audio.fill(0);
    if (!result.embedding || result.speechMs < 2000) throw new Error('enrollment_failed');
    profiles.push({ uid: `sample-${i}`, label: `公開サンプル${i}`, embedding: result.embedding });
  }
  for (let i = 1; i <= 2; i++) {
    const audio = pcm(await readFile(resolve(folder, `speaker-${i}-test.wav`)));
    const row = { sample: i, windows: 0, speechWindows: 0, correct: 0, wrong: 0, unknown: 0, silenceOrShort: 0 };
    for (let at = 0; at + 32000 <= audio.length; at += 32000) {
      const result = await worker.analyze(audio.subarray(at, at + 32000)); row.windows++;
      if (result.speechMs < 400) { row.silenceOrShort++; result.embedding?.fill(0); continue; }
      row.speechWindows++; const match = matchSpeaker(result.embedding, profiles); result.embedding?.fill(0);
      if (!match.uid) row.unknown++; else if (match.uid === `sample-${i}`) row.correct++; else row.wrong++;
    }
    audio.fill(0); report.push(row);
  }
  const result = { scope: 'Public Chinese human voices, separate enrollment/test recordings, 1-second windows, local actual CAM++ model; not a classroom accuracy benchmark', sources: JSON.parse(await readFile(resolve(folder, 'sources.json'), 'utf8')), report };
  await writeFile(resolve(folder, 'evaluation.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ scope: result.scope, report }));
  if (report.some((r) => !r.correct)) process.exitCode = 1;
} finally { profiles.forEach((p) => p.embedding.fill(0)); worker.close(); }
