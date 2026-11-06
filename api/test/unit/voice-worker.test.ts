import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpeakerWorker } from '../../src/voice-worker.js';
async function fixture(code: string, fn: (w: SpeakerWorker) => Promise<void>, timeouts?: { startupMs: number; analysisMs: number }) {
  const path = await mkdtemp(join(tmpdir(), 'discuss-voice-worker-'));
  await writeFile(join(path, 'worker.cjs'), code);
  const w = new SpeakerWorker(process.execPath, join(path, 'worker.cjs'), timeouts);
  try { await fn(w); } finally { w.close(); await rm(path, { recursive: true }); }
}
const ready = "console.log(JSON.stringify({ready:true}));";
const reader = "require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const data=JSON.parse(line);";
describe('音声特徴ワーカーのIPC', () => {
  it('音声をファイルに書かず渡し、範囲を検査した特徴だけを受け取る', async () => {
    await fixture(ready + reader + "console.log(JSON.stringify({id:data.id,ok:true,segments:[{startMs:0,endMs:8000}],speechMs:8000,embedding:Array(16).fill(.25)}));});", async (w) => {
      const result = await w.analyze(Buffer.alloc(32000)); expect(result.embedding).toHaveLength(16); expect(result.speechMs).toBe(8000);
    });
  });
  it.each(["{id:data.id,ok:false}", "{id:data.id,ok:true,segments:[],speechMs:1,embedding:[1]}"] )('失敗/不正な特徴を登録しない: %s', async (result) => {
    await fixture(ready + reader + `console.log(JSON.stringify(${result}));});`, async (w) => { await expect(w.analyze(Buffer.alloc(10))).rejects.toThrow('speaker_analysis_failed'); });
  });
  it('推論の時間超過で待機を解放し、プロセスを終了する', async () => {
    await fixture(ready + 'process.stdin.resume();', async (w) => { await expect(w.analyze(Buffer.alloc(10))).rejects.toThrow('speaker_timeout'); }, { startupMs: 1000, analysisMs: 30 });
  });
  it('起動しないワーカーと途中終了を失敗として扱う', async () => {
    await fixture('process.stdin.resume();', async (w) => { await expect(w.analyze(Buffer.alloc(10))).rejects.toThrow('speaker_unavailable'); }, { startupMs: 30, analysisMs: 1000 });
    await fixture('process.exit(1);', async (w) => { await expect(w.analyze(Buffer.alloc(10))).rejects.toThrow('speaker_unavailable'); });
  });
  it('同時推論数を制限して過負荷を拒否する', async () => {
    await fixture(ready + 'process.stdin.resume();', async (w) => {
      const pending = Array.from({ length: 16 }, () => w.analyze(Buffer.alloc(10)).catch((e: Error) => e));
      await new Promise((resolve) => setTimeout(resolve, 150));
      await expect(w.analyze(Buffer.alloc(10))).rejects.toMatchObject({ code: 'speaker_busy' });
      w.close(); expect(await Promise.all(pending)).toHaveLength(16);
    });
  });
  it('ワーカーが不正なJSONを出したら進行中の登録を止める', async () => {
    await fixture(ready + reader + "console.log('broken-json');});", async (w) => { await expect(w.analyze(Buffer.alloc(10))).rejects.toThrow('speaker_unavailable'); });
  });
});
