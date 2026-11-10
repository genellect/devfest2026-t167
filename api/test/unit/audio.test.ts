import { expect, it } from 'vitest';
import { validateAudio } from '../../src/audio.js';
import { readFileSync } from 'node:fs';
import { wave } from '../fixtures/audio.js';
it('実データの形式・長さを調べ、破損・形式偽装・過長を拒否する', async () => {
  await expect(validateAudio(wave(2, 8000), 'audio/wav', 2)).resolves.toBe(2);
  await expect(validateAudio(wave(2), 'audio/webm', 2)).rejects.toMatchObject({ code: 'invalid_audio' });
  await expect(validateAudio(Buffer.alloc(2000), 'audio/wav', 2)).rejects.toMatchObject({ code: 'invalid_audio' });
  await expect(validateAudio(wave(2), 'audio/wav', 60)).rejects.toMatchObject({ code: 'duration_mismatch' });
  await expect(validateAudio(wave().subarray(0, 1100), 'audio/wav', 600)).rejects.toMatchObject({ code: 'duration_mismatch' });
  await expect(validateAudio(wave(1900), 'audio/wav', 1)).rejects.toMatchObject({ code: 'recording_too_long' });
  // 区間に分けた録音は、端末の見積もりと比べず、測った長さを返す
  await expect(validateAudio(wave(2, 8000), 'audio/wav')).resolves.toBe(2);
});

it('同時パーサーの上限を超える要求を拒否し、完了後に枠を戻す', async () => {
  const first = validateAudio(wave(2, 8000), 'audio/wav', 2);
  const second = validateAudio(wave(2, 8000), 'audio/wav', 2);
  await expect(validateAudio(wave(2, 8000), 'audio/wav', 2)).rejects.toMatchObject({ code: 'audio_busy' });
  await Promise.all([first, second]);
  await expect(validateAudio(wave(2, 8000), 'audio/wav', 2)).resolves.toBe(2);
});

// 本番で、2分を超える録音がすべて invalid_audio になった（2026-11-10）。Chrome の MediaRecorder は Cluster の長さを不明のまま書き、
// 区切りを15秒ごとに作る。長さ不明の Cluster の終わりを次の Cluster の手前にしないと、区切りのたびに入れ子が深くなり、上限で落ちていた。
// 固定データは、Chrome の擬似マイク（電子音）を1秒ごとに区切って12秒録ったもの（区切り12個。人の声は入っていない）
it('Chrome の MediaRecorder の WebM（長さ不明の区切りが多い）の長さを読める', async () => {
  const audio = readFileSync(new URL('../fixtures/chrome-mediarecorder-12s.webm', import.meta.url));
  const seconds = await validateAudio(audio, 'audio/webm', 12);
  expect(seconds).toBeGreaterThan(11);
  expect(seconds).toBeLessThan(14);
  // 画面を開き直す前の書きかけの録音（MediaRecorder の区切りは要素の途中のこともある）も、書き終えたところまでを読む
  for (const cut of [500, 1500, 4000]) {
    const partial = await validateAudio(audio.subarray(0, audio.length - cut), 'audio/webm');
    expect(partial).toBeGreaterThan(5); expect(partial).toBeLessThan(seconds);
  }
  // ファイルの途中で壊れているものは読まない
  const broken = Buffer.from(audio); broken.fill(0, 200, 260);
  await expect(validateAudio(broken, 'audio/webm')).rejects.toMatchObject({ code: 'invalid_audio' });
});
