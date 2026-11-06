"use client";
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/ui';
import { MvpGate } from '@/components/mvp/MvpGate';
import { mvpApi } from '@/lib/mvp';
import { signOutHost } from '@/lib/hostAuth';

export default function Home() { return <MvpGate><Contents /></MvpGate>; }
function Contents() {
  const [rows, setRows] = useState<{ id: string; title: string; phase: string; role: string }[]>([]), [error, setError] = useState('');
  const load = useCallback(() => { void mvpApi<{ discussions: typeof rows }>('/list').then((data) => { setRows(data.discussions); setError(''); }).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  async function eraseVoice() { if (!window.confirm('このGoogleアカウントに保存した声の特徴を削除しますか？')) return; try { await mvpApi('/voice/delete', {}); setError('保存した声の特徴を削除しました。'); } catch (e) { setError((e as Error).message); } }
  return <main className="screen"><Header title="ホーム"><button className="btn btn--small" onClick={() => void signOutHost()}>ログアウト</button></Header><div className="body stack">
    <section className="box box--blue pad-lg stack"><h2 className="t-lg">話し合いをはじめよう</h2><p>セッションごとに、HostまたはGuestとして参加します。</p><Link className="btn btn--yellow" href="/participate">参加する</Link></section>
    <h2 className="t-md">参加したセッション</h2>{rows.length === 0 && !error && <p>まだ参加したセッションはありません。</p>}
    {rows.map((r) => <Link key={r.id} className="box pad mvp-session-link" href={`/discussions/${r.id}`}><strong>{r.title}</strong><span>{r.role === 'host' ? 'Host' : 'Guest'} · {r.phase === 'ended' ? '結果' : r.phase === 'discussing' ? '議論中' : '開始前'}</span></Link>)}
    {error && <p role="status">{error}</p>}<div className="row"><button className="btn btn--small" onClick={load}>一覧を更新</button><button className="btn btn--small" onClick={() => void eraseVoice()}>保存した声の特徴を削除</button><Link className="btn btn--small" href="/about">使い方</Link></div>
  </div></main>;
}
