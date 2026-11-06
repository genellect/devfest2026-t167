import { afterEach, describe, expect, it, vi } from 'vitest';
import { externalCall, ExternalTimeout, retryable } from '../../src/external-call.js';
afterEach(() => { vi.useRealTimers(); });
describe('外部処理の期限と再試行', () => {
  it('成功・失敗時にタイマーを残さない', async () => {
    vi.useFakeTimers();
    expect(await externalCall(async () => 7, 100)).toBe(7);
    await expect(externalCall(async () => { throw new Error('invalid'); }, 100)).rejects.toThrow('invalid');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('時間切れで実際にsignalを中断し、遅延した処理を採用しない', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const result = externalCall((s) => { signal = s; return new Promise(() => {}); }, 100);
    const assertion = expect(result).rejects.toBeInstanceOf(ExternalTimeout);
    await vi.advanceTimersByTimeAsync(101); await assertion;
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('一時的な503だけ予算内で再試行し、認証・検証エラーは繰り返さない', async () => {
    vi.useFakeTimers(); let calls = 0;
    const result = externalCall(async () => { if (++calls === 1) throw { status: 503 }; return 1; }, 1000, 1);
    await vi.advanceTimersByTimeAsync(250); expect(await result).toBe(1); expect(calls).toBe(2);
    for (const status of [400, 401, 403, 404]) expect(retryable({ status })).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('再試行待機中の時間切れでもタイマーを残さない', async () => {
    vi.useFakeTimers();
    const result = externalCall(async () => { throw { status: 503 }; }, 100, 1);
    const assertion = expect(result).rejects.toBeInstanceOf(ExternalTimeout);
    await vi.advanceTimersByTimeAsync(101); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
