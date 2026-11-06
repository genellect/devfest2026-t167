import type { Handler } from './http.js';
import { HttpError, wrap, type AuthRequest } from './http.js';
import type { Response } from 'express';
/** 音声Bufferとbase64が同時に積み上がらないよう、本文を受け取る前に枠を確保する。 */
export function createAudioAdmission(max = 4) {
  let active = 0;
  const admit: Handler = (_req, res, next) => {
    if (active >= max) { next(new HttpError(429, 'audio_busy', '音声の送信が混み合っています。少し待ってください', { retryAfterSec: 3 })); return; }
    active++; let released = false;
    res.locals.releaseAudio = () => { if (!released) { released = true; active--; } };
    // 通信断でも解析中の枠は保持する。本文の受信中だけ、切断時に解放する。
    res.once('close', () => { if (!res.locals.audioStarted) res.locals.releaseAudio(); });
    res.once('finish', res.locals.releaseAudio);
    next();
  };
  const handle = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) => wrap(async (req, res) => {
    res.locals.audioStarted = true;
    try { await fn(req, res); }
    finally { res.locals.releaseAudio(); }
  });
  return { admit, handle };
}
