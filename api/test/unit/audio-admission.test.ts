import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { createAudioAdmission } from '../../src/audio-admission.js';
import type { Request, Response } from 'express';
it('本文受信前に制限し、解析中の通信断で枠を再利用させず、完了後に解放する', async () => {
  const admission = createAudioAdmission(1), req = {} as Request;
  const response = () => Object.assign(new EventEmitter(), { locals: {} }) as unknown as Response;
  const first = response(); let error: unknown;
  admission.admit(req, first, (e) => { error = e; }); expect(error).toBeUndefined();
  admission.admit(req, response(), (e) => { error = e; }); expect(error).toMatchObject({ code: 'audio_busy' });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const handled = admission.handle(async () => { await pending; });
  handled(req, first, () => {});
  first.emit('close');
  admission.admit(req, response(), (e) => { error = e; }); expect(error).toMatchObject({ code: 'audio_busy' });
  release(); await pending; await Promise.resolve();
  admission.admit(req, response(), (e) => { error = e; }); expect(error).toBeUndefined();
});
it('本文受信中の切断とエラー応答では枠を返し、二重解放しない', () => {
  const admission = createAudioAdmission(1), req = {} as Request;
  const response = () => Object.assign(new EventEmitter(), { locals: {} }) as unknown as Response;
  const first = response(); admission.admit(req, first, () => {}); first.emit('close'); first.emit('finish');
  let error: unknown;
  const second = response(); admission.admit(req, second, (e) => { error = e; }); expect(error).toBeUndefined();
  admission.admit(req, response(), (e) => { error = e; }); expect(error).toMatchObject({ code: 'audio_busy' });
});
