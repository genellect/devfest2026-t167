import { Worker } from 'node:worker_threads';
import { HttpError } from './http.js';
import { MAX_RECORDING_SEC } from './policy.js';
let active = 0;
function matchesContainer(audio: Buffer, mime: string): boolean {
  if (mime.includes('webm')) return audio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime.includes('mp4')) return audio.toString('ascii', 4, 8) === 'ftyp';
  if (mime.includes('wav')) return audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
  if (mime.includes('ogg')) return audio.toString('ascii', 0, 4) === 'OggS';
  return audio.toString('ascii', 0, 3) === 'ID3' || (audio[0] === 255 && (audio[1] & 0xe0) === 0xe0);
}
/** 認証・所属確認後だけ呼ぶ。壊れたファイルのCPU・メモリ消費をAPIから隔離する。 */
export async function validateAudio(audio: Buffer, mimeType: string, claimedDuration: number): Promise<number> {
  if (!matchesContainer(audio, mimeType)) throw new HttpError(400, 'invalid_audio', '音声の形式を確認できません。録音し直してください');
  if (active >= 2) throw new HttpError(429, 'audio_busy', '音声を確認中です。少し待ってから送ってください', { retryAfterSec: 3 });
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const worker = new Worker(new URL(`./audio-worker.${extension}`, import.meta.url), { workerData: { audio, mimeType }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 48 } });
  active++;
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const fail = () => reject(new HttpError(400, 'invalid_audio', '音声を読み取れません。録音し直してください'));
      const timer = setTimeout(fail, 5_000);
      worker.once('message', (result) => { clearTimeout(timer); if (result.error) fail(); else resolve(result.duration); });
      worker.once('error', () => { clearTimeout(timer); fail(); });
      worker.once('exit', () => { clearTimeout(timer); fail(); });
    });
    if (duration > MAX_RECORDING_SEC) throw new HttpError(413, 'recording_too_long', '録音は30分までです');
    if (Math.abs(duration - claimedDuration) > Math.max(3, duration * 0.05)) throw new HttpError(400, 'duration_mismatch', '録音の長さが一致しません。録音し直してください');
    return duration;
  } finally { await worker.terminate(); active--; }
}
