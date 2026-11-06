"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { mvpApi, type MvpState } from '@/lib/mvp';
import { loadDraft, removeDraft, saveDraft, type DraftRecording } from '@/lib/mvp-audio';

/** 録音と分析を分離する。Host終了・時間切れで止め、端末保存後にだけ送信する。 */
export function MvpRecording({ room, uid, refresh }: { room: MvpState; uid: string; refresh: () => Promise<void> }) {
  const key = `${uid}:${room.id}`;
  const [consent, setConsent] = useState(false), [state, setState] = useState<'idle' | 'asking' | 'recording' | 'stopped'>('idle');
  const [draft, setDraft] = useState<DraftRecording>(), [upload, setUpload] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle'), [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0), [download, setDownload] = useState('');
  const recorder = useRef<MediaRecorder | undefined>(undefined), started = useRef(0), inFlight = useRef(false), attempted = useRef(false);
  const stop = useCallback(() => { if (recorder.current?.state === 'recording') recorder.current.stop(); }, []);
  useEffect(() => {
    void loadDraft(key).then((saved) => { if (saved) { setDraft(saved); setState('stopped'); } }).catch((e: Error) => setError(e.message));
    return stop;
  }, [key, stop]);
  useEffect(() => {
    if (!draft) return;
    const url = URL.createObjectURL(draft.blob); setDownload(url); return () => URL.revokeObjectURL(url);
  }, [draft]);
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => { const elapsed = Math.floor((Date.now() - started.current) / 1000); setSeconds(elapsed); if (elapsed >= 1800) stop(); }, 500);
    return () => clearInterval(timer);
  }, [state, stop]);
  const unsent = state === 'recording' || state === 'asking' || !!draft && upload !== 'done';
  useEffect(() => {
    if (!unsent) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const leave = (event: MouseEvent) => { if ((event.target as Element).closest('a[href="/home"]') && !window.confirm('録音を停止して端末に残します。ホームへ戻りますか？')) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', leave, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', leave, true); };
  }, [unsent]);
  const send = useCallback(async () => {
    if (!draft || inFlight.current) return;
    inFlight.current = true; setUpload('sending'); setError('');
    try {
      await mvpApi(`/room/${room.id}/recording?consent=1&runId=${encodeURIComponent(draft.runId)}&seconds=${Math.max(1, Math.round(draft.seconds))}`, draft.blob);
      setUpload('done');
      try { await removeDraft(key); } catch (e) { setError((e as Error).message); }
      await refresh();
    } catch (e) { setError((e as Error).message); setUpload('failed'); }
    finally { inFlight.current = false; }
  }, [draft, room.id, key, refresh]);
  useEffect(() => { if (room.phase === 'ended') stop(); }, [room.phase, stop]);
  useEffect(() => { if (room.phase === 'ended' && draft && !attempted.current) { attempted.current = true; void send(); } }, [room.phase, draft, send]);
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('マイクを使えるHTTPS対応ブラウザで開いてください'); return; }
    setState('asking'); setError('');
    let stream: MediaStream | undefined;
    try {
      // 許可を拒否した端末が録音担当を占有しないよう、マイク許可を先に確かめる。
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const { runId } = await mvpApi<{ runId: string }>(`/room/${room.id}/claim-recording`, {});
      const active = new MediaRecorder(stream, { audioBitsPerSecond: 32000 }); recorder.current = active;
      const tracks = stream.getTracks(), chunks: Blob[] = []; let bytes = 0;
      active.ondataavailable = (event) => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes >= 11 * 1024 * 1024 && active.state === 'recording') active.stop(); } };
      active.onerror = () => { setError('録音中に問題が発生しました。端末に残った音声を確認してください'); stop(); };
      active.onstop = () => {
        tracks.forEach((t) => t.stop()); setState('stopped');
        const saved = { key, runId, blob: new Blob(chunks, { type: active.mimeType }), seconds: (Date.now() - started.current) / 1000 };
        setDraft(saved); void saveDraft(saved).catch((e: Error) => setError(e.message));
      };
      started.current = Date.now(); active.start(1000); setState('recording');
    } catch (e) { stream?.getTracks().forEach((t) => t.stop()); setError(`録音を開始できませんでした：${(e as Error).message}`); setState('idle'); }
  }
  if (room.phase === 'waiting') return null;
  return <section className="box pad stack" aria-label="議論の録音"><h2 className="t-md">議論の録音</h2>
    {room.phase === 'discussing' && state === 'idle' && <><label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />グループ全員が録音とAI分析に同意しました</label><button className="btn btn--blue" disabled={!consent} onClick={() => void start()}>録音を始める</button></>}
    {state === 'asking' && <p role="status">マイクの許可を確認しています…</p>}{state === 'recording' && <><p role="status">録音中 · {seconds}秒</p><button className="btn" onClick={stop}>録音を停止して端末に保管</button></>}
    {draft && upload !== 'done' && <p>録音はこの端末に保持しています。議論終了後、5分以内に送信してください。</p>}
    {upload === 'sending' && <p role="status">録音を送信して分析しています。しばらくお待ちください。</p>}{upload === 'done' && <p role="status">録音の送信・分析が完了しました。</p>}
    {error && <p role="alert">{error}</p>}{upload === 'failed' && <button className="btn" onClick={() => void send()}>録音を再送する</button>}
    {download && upload !== 'done' && <a className="btn" href={download} download={`t167-recording.${draft?.blob.type.includes('mp4') ? 'mp4' : 'webm'}`}>録音をダウンロードして保管</a>}
  </section>;
}
