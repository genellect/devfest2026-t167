"use client";
import Link from 'next/link';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Header, Loading } from '@/components/ui';
import { mvpApi, type MvpState, type MvpResult } from '@/lib/mvp';
import { firebase } from '@/lib/firebase';
import { recordVoice, voicePcm } from '@/lib/mvp-audio';
import { MvpRecording } from './MvpRecording';

export function MvpRoom({ id }: { id: string }) {
  const [room, setRoom] = useState<MvpState>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    try { const next = await mvpApi<MvpState>(`/room/${id}`); if (ticket === generation.current) { setRoom(next); setConnected(true); } }
    catch (e) { if (ticket === generation.current) { setConnected(false); setError((e as Error).message); } }
  }, [id]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 2000); return () => { clearInterval(timer); invalidate(); }; }, [load, invalidate]);
  async function act(path: string, body: object = {}) {
    setBusy(true); setError('');
    try { await mvpApi(`/room/${id}/${path}`, body); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!room) return error ? <main className="screen"><div className="body"><p role="alert">{error}</p><button className="btn" onClick={() => void load()}>再接続する</button><Link className="btn" href="/home">ホームに戻る</Link></div></main> : <Loading />;
  return <main className="screen"><Header title={room.title} eyebrow={`${room.role === 'host' ? 'Host' : 'Guest'} · ${room.phase === 'waiting' ? '開始前' : room.phase === 'discussing' ? '議論中' : '結果'}`}><Link className="btn btn--small" href="/home">ホームに戻る</Link></Header><div className="body stack">
    {error && <p className="notice notice--error" role="alert">{error}</p>}{!connected && <p role="status">接続を確認しています。録音は端末に保持します。</p>}
    {room.source === 'mock' && <p className="notice">ローカルのデモデータを使っています。実AIの分析結果ではありません。</p>}
    {room.role === 'host' ? <Host room={room} disabled={busy || !connected} act={act} /> : <Guest room={room} refresh={load} />}
  </div></main>;
}

function Host({ room, disabled, act }: { room: MvpState; disabled: boolean; act: (path: string, body?: object) => Promise<void> }) {
  const [qr, setQr] = useState(''), [confirm, setConfirm] = useState(false);
  useEffect(() => { if (room.code) void QRCode.toDataURL(`${window.location.origin}/join?code=${room.code}`, { width: 280, margin: 2 }).then(setQr); }, [room.code]);
  const allReady = room.members.length > 0 && room.members.every((m) => m.ready);
  return <>
    {room.phase === 'waiting' && <section className="box box--blue pad-lg stack"><h2 className="t-md">参加コードとQR</h2><p className="join-code" data-testid="join-code">{room.code}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr && <img src={qr} width={280} height={280} className="mvp-qr" alt={`参加用QRコード ${room.code}`} />}<p>Guest全員の表示名と音声登録が済んだら、議論を開始できます。</p><button className="btn btn--yellow" disabled={disabled || !allReady} onClick={() => void act('start')}>ディスカッションを開始</button></section>}
    {room.phase !== 'ended' && <details className="box pad mvp-settings"><summary>セッション設定</summary><form className="stack" key={`${room.title}-${room.theme}-${room.minutes}`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act('settings', { title: f.get('title'), theme: f.get('theme'), minutes: Number(f.get('minutes')), recording: f.get('recording') === 'on' }); }}>
      <label className="field">セッション名<input className="input" name="title" defaultValue={room.title} required maxLength={100} disabled={room.phase !== 'waiting'} /></label><label className="field">テーマ<textarea aria-label="テーマ" className="input" name="theme" defaultValue={room.theme ?? ''} required maxLength={1000} disabled={room.phase !== 'waiting'} /></label>
      <label className="field">制限時間（分）<input className="input" type="number" min={1} max={30} name="minutes" defaultValue={room.minutes} disabled={room.phase !== 'waiting'} /></label><label><input type="checkbox" name="recording" defaultChecked={room.recording} disabled={room.phase !== 'waiting'} />録音して分析する</label>
      <button className="btn" disabled={disabled || room.phase !== 'waiting'}>設定を保存</button></form></details>}
    <section className="box pad stack"><h2 className="t-md">Guestへの表示・結果公開</h2>{(['theme', 'timer', 'members'] as const).map((key, i) => <label key={key}><input type="checkbox" checked={room.visible[key]} disabled={disabled} onChange={(e) => void act('settings', { visible: { ...room.visible, [key]: e.target.checked } })} />Guestに{['テーマ', '残り時間', '所属グループの参加者'][i]}を表示</label>)}
      <label><input type="checkbox" checked={room.publishOnEnd} disabled={disabled} onChange={(e) => void act('settings', { publishOnEnd: e.target.checked })} />終了時に結果を自動公開</label><label><input type="checkbox" checked={room.published} disabled={disabled} onChange={(e) => void act('settings', { published: e.target.checked })} />所属グループの結果を公開</label></section>
    {room.phase === 'discussing' && <section className="box box--yellow pad stack"><h2>ディスカッション中</h2><Timer endsAt={room.endsAt} /><button className="btn btn--ink" disabled={disabled} onClick={() => setConfirm(true)}>ディスカッションを終了</button>{confirm && <div role="alertdialog" aria-label="終了を確認"><p>全グループの議論を終了し、結果へ進みますか？</p><button className="btn" onClick={() => setConfirm(false)}>続ける</button><button className="btn btn--blue" disabled={disabled} onClick={() => { setConfirm(false); void act('finish'); }}>終了して結果を見る</button></div>}</section>}
    {room.phase === 'ended' && <section className="box box--blue pad-lg stack"><h2 className="t-md">セッション全体の結果</h2><p>{room.endReason === 'timeout' ? '設定した時間になりました。' : 'Hostが議論を終了しました。'}</p><p>分析済み {room.results.length}/{room.groups}グループ。未分析の内容は推測で補いません。</p>{room.results.flatMap((r) => r.teacherSuggestions.map((text, i) => <p key={`${r.group}-${i}`}>グループ{r.group}：{text}</p>))}</section>}
    <div className="grid-auto">{Array.from({ length: room.groups }, (_, i) => i + 1).map((group) => <section className="box pad stack" key={group}><h2 className="t-md">グループ{group}</h2>{room.members.filter((m) => m.group === group).map((m) => <p key={m.uid}>{m.attendees.map((a) => a.name).join('、') || '表示名を登録中'} · {m.ready ? '準備完了' : '音声登録を待っています'}</p>)}{!room.members.some((m) => m.group === group) && <p>参加者はまだいません。</p>}{room.phase === 'ended' && <Results room={room} group={group} />}</section>)}</div>
  </>;
}

function Guest({ room, refresh }: { room: MvpState; refresh: () => Promise<void> }) {
  const [mode, setMode] = useState<'personal' | 'shared'>('personal'), [names, setNames] = useState(['']), [group, setGroup] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(''), [consent, setConsent] = useState(false), [registering, setRegistering] = useState(''), [seconds, setSeconds] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function saveNames(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await mvpApi(`/room/${room.id}/names`, { mode, names, group }); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function enroll(id: string, file?: File) {
    setRegistering(id); setSeconds(0); setError(''); const active = new AbortController(); controller.current = active;
    let pcm: ArrayBuffer | undefined;
    try { pcm = await voicePcm(file ?? await recordVoice(active.signal, setSeconds)); await mvpApi(`/room/${room.id}/voice/${id}?consent=1`, pcm, active.signal); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { if (pcm) new Int16Array(pcm).fill(0); setRegistering(''); }
  }
  return <>{error && <p role="alert">{error}</p>}
    {room.phase === 'waiting' && !room.own.attendees.length && <form className="box pad-lg stack" onSubmit={saveNames}><h2>表示名を設定</h2><label className="field">参加する端末<select className="input" value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setNames(['']); }}><option value="personal">各自の端末</option><option value="shared">1台の端末で複数人</option></select></label>{names.map((name, i) => <label className="field" key={i}>参加者{i + 1}の表示名<input className="input" value={name} maxLength={40} required onChange={(e) => setNames(names.map((n, index) => index === i ? e.target.value : n))} /></label>)}
      {mode === 'shared' && <button type="button" className="btn" disabled={names.length >= 8} onClick={() => setNames([...names, ''])}>参加者を追加</button>}
      <label className="field">所属グループ<select className="input" value={group} onChange={(e) => setGroup(Number(e.target.value))}>{Array.from({ length: room.groups }, (_, i) => <option key={i} value={i + 1}>グループ{i + 1}</option>)}</select></label><button className="btn btn--blue" disabled={busy}>表示名を保存して進む</button></form>}
    {room.phase === 'waiting' && room.own.attendees.length > 0 && !room.own.ready && <section className="box pad-lg stack"><h2>初回の音声登録</h2><p>{room.own.mode === 'personal' ? '声の特徴をこのGoogleアカウントに保存し、次回から再利用します。元の音声は保存しません。' : '共有端末の全員が1人ずつ登録します。特徴は議論終了時に削除します。'}</p><p>1人で9秒間、「私たちは、お互いの意見を聞き、理由を考えながら、よりよいアイデアを見つけます」と読んでください。</p><label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />声の特徴の登録と利用に同意します</label>
      {room.own.attendees.map((a) => <div key={a.id} className="box pad stack"><h3>{a.name}</h3><button className="btn" disabled={!consent || !!registering || a.registered} onClick={() => void enroll(a.id)}>{a.registered ? '登録済み' : registering === a.id ? '音声を登録しています…' : '声を登録する'}</button>{registering === a.id && <p role="status">録音・処理中 {seconds} / 9秒</p>}<label className="field">{a.name}の登録用音声ファイル<input type="file" accept="audio/*" disabled={!consent || !!registering || a.registered} onChange={(e) => { const file = e.target.files?.[0]; if (file) void enroll(a.id, file); e.target.value = ''; }} /></label></div>)}
      <p>音声登録は本人認証や話者識別精度の保証ではありません。</p>{room.voiceSource === 'mock' && <p>ローカルの音声登録はモックです。</p>}</section>}
    {room.phase === 'waiting' && room.own.ready && <section className="box box--yellow pad-lg stack"><h2>待機画面</h2><p>Hostのディスカッション開始を待っています。</p><p>{room.own.attendees.map((a) => a.name).join('、')} · グループ{room.own.group}</p></section>}
    {room.phase === 'discussing' && <section className="box box--blue pad-lg stack"><h2>グループで話し合いましょう</h2>{room.theme !== null && <p>テーマ：{room.theme}</p>}{room.endsAt !== null && <Timer endsAt={room.endsAt} />}{room.visible.members && <p>参加者：{room.members.flatMap((m) => m.attendees.map((a) => a.name)).join('、')}</p>}</section>}
    {room.own.ready && room.recording && <MvpRecording room={room} uid={firebase().auth.currentUser!.uid} refresh={refresh} />}
    {room.phase === 'ended' && <section className="box pad-lg stack"><h2>ディスカッションの結果</h2><p>{room.endReason === 'timeout' ? '設定した時間になりました。' : 'Hostがディスカッションを終了しました。'}</p><Results room={room} group={room.own.group ?? 1} /></section>}
  </>;
}

function Timer({ endsAt }: { endsAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.ceil(((endsAt ?? now) - now) / 1000));
  return <p role="timer">残り時間 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>;
}
function Results({ room, group }: { room: MvpState; group: number }) {
  const result = room.results.find((r) => r.group === group);
  if (room.role !== 'host' && !room.published) return <p>結果はHostの公開後に表示されます。</p>;
  if (!result) return <p>{room.jobs.find((j) => j.group === group)?.status === 'running' ? '録音を分析しています。' : room.recording ? '録音の送信・分析結果を待っています。' : '録音しなかったため、音声の分析結果はありません。'}</p>;
  return <Flow result={result} />;
}
function Flow({ result }: { result: MvpResult }) {
  return <div className="stack"><p>{result.source === 'mock' ? 'デモデータ' : 'Geminiによる推定'}</p>{!result.speechDetected && <p>議論の音声を十分に確認できませんでした。</p>}<p>{result.flowNote}</p><h3>議論の流れ</h3>{result.segments.map((s, i) => <p key={i}>{s.topic} · {s.minutes}分</p>)}<h3>よかった点</h3>{result.good.map((p, i) => <p key={i}>{p.at} {p.text}</p>)}<h3>振り返るポイント</h3>{result.review.map((p, i) => <div key={i}><p>{p.at} {p.text}</p>{p.question && <p>次の問い：{p.question}</p>}</div>)}</div>;
}
