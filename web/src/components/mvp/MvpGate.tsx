"use client";
import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { canUseTestHost, signInAsHost, signInAsTestHost, signInAsTestStudent, useHostUser } from '@/lib/hostAuth';
import { Loading } from '@/components/ui';

export function MvpGate({ children }: { children: ReactNode }) {
  const user = useHostUser(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function login(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (user === undefined) return <Loading />;
  if (user) return <>{children}</>;
  return <main className="screen login"><section className="box--blue login__hero"><h1 className="t-hero login__title">話し合いのあとに、<br />次の一歩が見つかる。</h1><p className="t-label login__lead">一人ひとりの考えを、次の議論につなげます。</p></section>
    <section className="login__panel"><h2 className="t-md">Googleでログイン</h2><p>HostもGuestも、同じホームから参加できます。</p><button className="btn btn--yellow btn--block" disabled={busy} onClick={() => void login(signInAsHost)}>{busy ? 'ログインしています…' : 'Googleでログイン'}</button>
      {canUseTestHost && <div className="stack"><p>ローカルの認証エミュレータです。</p><button className="btn" disabled={busy} onClick={() => void login(signInAsTestHost)}>テスト用の先生でログイン（エミュレータ）</button><button className="btn" disabled={busy} onClick={() => void login(signInAsTestStudent)}>テスト用の生徒でログイン（エミュレータ）</button></div>}
      {error && <p role="alert">{error}</p>}<Link href="/about">使い方とプライバシー</Link>
    </section></main>;
}
