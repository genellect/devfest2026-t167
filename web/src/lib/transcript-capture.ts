"use client";
import { authenticatedFetch } from './session';

/** PCMは送信中と待機中だけ保持する。順番と同一バッファを保った再送で二重文字起こしを防ぐ。 */
export class TranscriptCapture {
  private capture = crypto.randomUUID();
  private frames: Int16Array[] = [];
  private queue = Promise.resolve();
  private pending = 0;
  private sequence = 0;
  private failed = false;
  private closed = false;
  constructor(private roomId: string, private onError: (message: string) => void) {}
  feed(pcm: Int16Array) {
    if (this.closed || this.failed) return;
    this.frames.push(pcm.slice());
    if (this.frames.length === 10) this.flush();
  }
  private flush() {
    if (!this.frames.length) return;
    const frames = this.frames; this.frames = [];
    if (this.failed || this.pending >= 3) {
      frames.forEach(frame => frame.fill(0));
      this.failed = true; this.onError('文字起こしが遅れています。終了後の分析には元の録音を使用します。'); return;
    }
    const pcm = new Int16Array(frames.length * 16000);
    frames.forEach((frame, i) => { pcm.set(frame, i * 16000); frame.fill(0); });
    this.pending++;
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
        try {
          const response = await authenticatedFetch(`/rooms/${this.roomId}/transcripts/audio?sequence=${this.sequence}&capture=${this.capture}`, { method: 'POST', headers: { 'content-type': 'audio/pcm' }, body: pcm.buffer, signal: controller.signal });
          if (response.ok) { this.sequence++; return; }
          const data = await response.json();
          if (![409, 429, 503].includes(response.status) || (response.status === 409 && data.error?.code !== 'transcription_running')) throw new Error(data.error?.message ?? '文字起こしを停止しました');
          if (attempt === 2) throw new Error('文字起こしを再開できません。元の録音は端末に保持しています。');
        } catch (error) {
          if (error instanceof Error && error.name !== 'AbortError' && !(error instanceof TypeError)) throw error;
          if (attempt === 2) throw error;
        } finally { clearTimeout(timer); }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }).catch(() => {
      this.failed = true; this.onError('文字起こしを停止しました。元の録音から終了後に分析できます。');
    }).finally(() => { pcm.fill(0); this.pending--; });
  }
  async stop() { if (!this.closed) { this.closed = true; this.flush(); } await this.queue; }
}
