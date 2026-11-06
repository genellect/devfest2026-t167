"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/ui';
import { MvpGate } from '@/components/mvp/MvpGate';
import { mvpApi } from '@/lib/mvp';
export default function NewRoom() { return <MvpGate><Form /></MvpGate>; }
function Form() {
  const router = useRouter(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const f = new FormData(event.currentTarget);
    try { const data = await mvpApi<{ id: string }>('/create', { title: f.get('title'), theme: f.get('theme'), minutes: Number(f.get('minutes')), groups: Number(f.get('groups')), recording: f.get('recording') === 'on', visible: { theme: true, members: true, timer: true }, publishOnEnd: true }); router.push(`/discussions/${data.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="screen"><Header title="新しい議論を作る"><Link className="btn" href="/home">ホーム</Link></Header><div className="body body--center"><form className="box box--lg card" onSubmit={create}>
    <h2 className="card__title">今日の議論を準備する</h2><label className="field">セッション名<input className="input" name="title" required maxLength={100} placeholder="例：AIとの学び方" /></label>
    <label className="field">テーマ<textarea className="input" name="theme" required maxLength={1000} placeholder="例：授業でAIをどこまで活用する？" /></label>
    <label className="field">制限時間（分）<input className="input" name="minutes" type="number" min={1} max={30} defaultValue={15} required /></label>
    <label className="field">グループ数<select className="input" name="groups" defaultValue={1}>{[1,2,3,4,5,6,7,8].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
    <label><input name="recording" type="checkbox" defaultChecked />議論を録音して分析する</label><p>録音はグループごとに1台。全員の同意を得てから、Guestが録音を始めます。</p>
    {error && <p role="alert">{error}</p>}<button className="btn btn--blue btn--block" disabled={busy}>{busy ? '作成中…' : '部屋を作る'}</button>
  </form></div></main>;
}
