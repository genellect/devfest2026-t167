import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { HttpError } from './http.js';
export interface VoiceFeatures { segments: { startMs: number; endMs: number }[]; speechMs: number; embedding: number[] | null }
const resultSchema = z.object({ segments: z.array(z.object({ startMs: z.number().nonnegative(), endMs: z.number().nonnegative() })).max(100), speechMs: z.number().nonnegative(), embedding: z.array(z.number().finite()).min(16).max(2048).nullable() });
/** 1プロセスで推論を直列化する。音声は標準入力から渡し、ファイル/ログに書かない。 */
export class SpeakerWorker {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (v: VoiceFeatures) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private id = 0;
  private ready: Promise<void>;
  private stopped = false;
  /** 終了・時間超過・起動失敗のあとは使えない。呼び出し側が作り直す */
  get closed() { return this.stopped; }
  constructor(python: string, script: string, private timeouts = { startupMs: 30_000, analysisMs: 15_000 }) {
    this.child = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OMP_NUM_THREADS: '1' } });
    this.child.stderr.resume(); // 推論ライブラリの生の例外をアプリのログへ転送しない。
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('speaker_unavailable')), this.timeouts.startupMs);
      const lines = createInterface({ input: this.child.stdout });
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line);
          if (message.ready) { clearTimeout(timer); resolve(); return; }
          const item = this.pending.get(message.id);
          if (!item) return;
          clearTimeout(item.timer); this.pending.delete(message.id);
          const parsed = resultSchema.safeParse(message);
          if (!message.ok || !parsed.success) item.reject(new Error('speaker_analysis_failed'));
          else item.resolve(parsed.data);
        } catch { this.fail(); }
      });
      this.child.on('error', () => { clearTimeout(timer); reject(new Error('speaker_unavailable')); this.fail(); });
      this.child.on('exit', () => { this.stopped = true; clearTimeout(timer); reject(new Error('speaker_unavailable')); this.fail(); });
    });
    void this.ready.catch(() => this.close());
  }
  private fail() { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('speaker_unavailable')); } this.pending.clear(); }
  async analyze(pcm: Buffer): Promise<VoiceFeatures> {
    await this.ready;
    if (this.stopped) throw new Error('speaker_unavailable'); // 止めたプロセスの標準入力へ書かない
    if (this.pending.size >= 16) throw new HttpError(503, 'speaker_busy', '声の判別が混み合っています。少し待って再開してください');
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('speaker_timeout')); this.close(); }, this.timeouts.analysisMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, pcm: pcm.toString('base64') }) + '\n', (error) => { if (error) this.fail(); });
    });
  }
  close() { this.stopped = true; this.fail(); this.child.kill(); }
}

/**
 * 推論プロセスが止まったら（時間超過・異常終了）、次の依頼で作り直す。
 * 作り直しは restartDelayMs に1回までとし、壊れたモデルで起動を繰り返さない。
 */
export class RestartingSpeakerWorker {
  private worker: SpeakerWorker;
  private startedAt: number;
  constructor(private create: () => SpeakerWorker, private restartDelayMs = 10_000, private now = Date.now) {
    this.worker = create(); this.startedAt = now();
  }
  analyze(pcm: Buffer): Promise<VoiceFeatures> {
    if (this.worker.closed && this.now() - this.startedAt >= this.restartDelayMs) { this.worker = this.create(); this.startedAt = this.now(); }
    return this.worker.analyze(pcm);
  }
  close() { this.worker.close(); }
}
