"use client";
import { authenticatedFetch } from './session';
import { callApi } from './api';
import { TranscriptCapture } from './transcript-capture';
/** 同じマイクを録音と共有する。照合失敗でもMediaRecorderの端末保管は継続する。 */
export class SpeakerCapture {
  private transcript: TranscriptCapture;
  private worklet?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private mute?: GainNode;
  private stopped = false;
  private runId?: string;
  private frames: Int16Array[] = [];
  private history: Int16Array[] = [];
  private sequence = 0;
  private queued = 0;
  private controller?: AbortController;
  private queue = Promise.resolve();
  constructor(private roomId: string, private onError: (message: string) => void) { this.transcript = new TranscriptCapture(roomId, onError); }
  async start(stream: MediaStream, context: AudioContext) {
    try { const info = await callApi<{ runId: string }>(`/rooms/${this.roomId}/speaker/start`); this.runId = info.runId; }
    catch { this.onError('話者識別に接続できません。文字起こしと録音は継続します。'); }
    if (this.stopped) { await this.release(); return; }
    await context.audioWorklet.addModule('/live-pcm-worklet.js');
    if (this.stopped || !stream.active) { await this.release(); return; }
    const worklet = new AudioWorkletNode(context, 'discuss-pcm'); this.worklet = worklet;
    this.source = context.createMediaStreamSource(stream);
    this.mute = context.createGain(); this.mute.gain.value = 0;
    this.source.connect(worklet); worklet.connect(this.mute); this.mute.connect(context.destination);
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.stopped || !(event.data instanceof ArrayBuffer)) return;
      this.frames.push(new Int16Array(event.data));
      if (this.frames.length < 5) return;
      const pcm = new Int16Array(16000);
      this.frames.forEach((frame, i) => { pcm.set(frame, i * 3200); frame.fill(0); }); this.frames = [];
      this.transcript.feed(pcm);
      if (!this.runId) { pcm.fill(0); return; }
      if (this.queued >= 3) { pcm.fill(0); this.onError('話者識別の処理が遅れています。文字起こしと元の録音は継続しています。'); void this.release(); return; }
      this.history.push(pcm.slice());
      if (this.history.length > 3) this.history.shift()!.fill(0);
      const window = new Int16Array(this.history.length * 16000);
      this.history.forEach((frame, i) => window.set(frame, i * 16000)); pcm.fill(0);
      this.queued++;
      this.queue = this.queue.then(async () => {
        try {
          if (this.stopped) return;
          this.controller = new AbortController();
          const timer = setTimeout(() => this.controller?.abort(), 15_000);
          try {
            const response = await authenticatedFetch(`/rooms/${this.roomId}/speaker/${this.runId}/chunk?sequence=${this.sequence}`, { method: 'POST', headers: { 'content-type': 'audio/pcm' }, body: window.buffer, signal: this.controller.signal });
            if (!response.ok) { const data = await response.json(); throw new Error(data.error?.message ?? '話者識別を停止しました'); }
            this.sequence++;
          } finally { clearTimeout(timer); this.controller = undefined; }
        } finally { window.fill(0); this.queued--; }
      }).catch((e: Error) => { if (!this.stopped) { this.onError(e.message); void this.release(); } });
    };
  }
  private async release() {
    this.history.forEach(frame => frame.fill(0)); this.history = [];
    if (this.runId) await callApi(`/rooms/${this.roomId}/speaker/${this.runId}/stop`).catch(() => {});
    this.runId = undefined;
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true; this.controller?.abort(); this.worklet?.disconnect(); this.source?.disconnect(); this.mute?.disconnect();
    this.frames.forEach((f) => f.fill(0)); this.frames = [];
    this.history.forEach(frame => frame.fill(0)); this.history = [];
    await Promise.all([this.queue, this.transcript.stop()]); void this.release();
  }
}
