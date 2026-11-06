"use client";
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import jsQR from 'jsqr';
import { Header } from '@/components/ui';
import { MvpGate } from '@/components/mvp/MvpGate';
import { mvpApi, normalizeMvpCode } from '@/lib/mvp';
function Form() {
  const router = useRouter(), params = useSearchParams();
  const [code, setCode] = useState(() => normalizeMvpCode(params.get('code') ?? '')), [qr, setQr] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function readQr(file: File) {
    setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('10MB以内のQR画像を選んでください');
      const bitmap = await createImageBitmap(file), canvas = document.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const image = context.getImageData(0, 0, canvas.width, canvas.height), result = jsQR(image.data, canvas.width, canvas.height);
      if (!result) throw new Error('QRコードが見つかりません。全体が写るように撮影してください');
      const url = new URL(result.data);
      if (url.origin !== window.location.origin || url.pathname !== '/join' || !/^[A-Z0-9]{6}$/.test(url.searchParams.get('code') ?? '')) throw new Error('このアプリの参加用QRコードを選んでください');
      setCode(url.searchParams.get('code')!); setQr(false);
    } catch (e) { setError((e as Error).message); }
  }
  async function join(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const data = await mvpApi<{ id: string }>('/join', { code }); router.push(`/discussions/${data.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="screen"><Header title="議論に参加する"><Link href="/home" className="btn">ホーム</Link></Header><div className="body body--center"><form className="box box--lg card card--narrow" onSubmit={join}>
    <h2 className="card__title">参加方法を選択</h2><div className="row"><button className="btn" type="button" aria-pressed={!qr} onClick={() => setQr(false)}>コードで参加</button><button className="btn" type="button" aria-pressed={qr} onClick={() => setQr(true)}>QRで参加</button></div>
    {qr && <label className="field">QRを撮影または画像を選択<input aria-label="QRを撮影または画像を選択" type="file" accept="image/*" capture="environment" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readQr(file); e.target.value = ''; }} /></label>}
    <label className="field">参加コード<input className="input mvp-code" value={code} autoCapitalize="characters" autoComplete="off" maxLength={12} onChange={(e) => setCode(normalizeMvpCode(e.target.value))} /></label><p>Hostの画面にある英字と数字の6文字を入力してください。</p>{error && <p role="alert">{error}</p>}
    <button className="btn btn--blue btn--block" disabled={busy || code.length !== 6}>{busy ? '参加中…' : '参加する'}</button>
  </form></div></main>;
}
export default function Join() { return <MvpGate><Suspense><Form /></Suspense></MvpGate>; }
