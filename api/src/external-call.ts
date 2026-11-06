/** 期限を超えたSDK呼び出しを中断し、必ずタイマーを回収する。再試行は副作用のない読み取りだけ明示指定する。 */
export class ExternalTimeout extends Error { constructor() { super('external_timeout'); } }
export function retryable(error: unknown): boolean {
  const status = Number((error as { status?: number; code?: number })?.status ?? (error as { code?: number })?.code);
  return status === 429 || status === 502 || status === 503 || status === 504;
}
export async function externalCall<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, retries = 0): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ExternalTimeout()); }, timeoutMs);
  });
  async function attempt() {
    for (let n = 0; ; n++) {
      try { return await operation(controller.signal); }
      catch (error) {
        if (controller.signal.aborted || n >= retries || !retryable(error)) throw error;
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(delay); reject(new ExternalTimeout()); };
          const delay = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve(); }, 250 * 2 ** n);
          controller.signal.addEventListener('abort', cancel, { once: true });
        });
      }
    }
  }
  try { return await Promise.race([attempt(), timeout]); }
  finally { clearTimeout(timer!); }
}
