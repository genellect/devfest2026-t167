import { expect, it } from 'vitest';
import { validateAudio } from '../../src/audio.js';
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
