"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SchoolSecurity } from "@/components/SchoolSecurity";
import { Header } from "@/components/ui";
import { LOGOUT_MESSAGES, handleSessionFailure, logoutSession, restoreSession, sessionRequest, useAppSession, type SessionView } from "@/lib/session";
import { recoveryAudio, recoveryRecordings, unsavedAudio, deleteRecovery, type RecoveryRecording } from "@/lib/recording-recovery";
import { uploadRecording } from "@/lib/api";

export default function SessionsPage() {
  const current = useAppSession();
  const [sessions, setSessions] = useState<SessionView[]>([]), [error, setError] = useState("");
  const [recordings, setRecordings] = useState<RecoveryRecording[]>([]), [end, setEnd] = useState("");
  const [audio, setAudio] = useState<string>(), [busy, setBusy] = useState(false);
  async function load() {
    const response = await sessionRequest<{ sessions: SessionView[] }>("/sessions"); setSessions(response.sessions);
    if (current.user) {
      const memory = unsavedAudio(current.user.uid).map((v) => v.recording);
      const stored = await recoveryRecordings(current.user.uid).catch(() => []);
      setRecordings([...new Map([...stored, ...memory].map((v) => [v.id, v])).values()]);
    }
  }
  useEffect(() => { void load().catch(() => setError("端末の一覧を確認できません。接続を確認してください。")); /* 初回は有効なsession確定後 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  async function act(fn: () => Promise<unknown>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function revoke(id: string) {
    await sessionRequest("/sessions/revoke", "POST", { sessionId: id });
    if (id === current.session?.sessionId) await handleSessionFailure("session_revoked", "logout"); else await load();
  }
  async function shared() {
    const classEndsAt = new Date(end).getTime();
    if (!Number.isFinite(classEndsAt)) throw new Error("授業終了時刻を指定してください");
    await sessionRequest("/sessions/shared-device", "POST", { isSharedDevice: true, classEndsAt }); await restoreSession();
  }
  return <main className="screen session-screen"><Header title="端末とセッション"><Link href="/student" className="btn btn--small">ホーム</Link></Header>
    <div className="body"><section className="session-list">
      <h2 className="t-md">ログインしている端末</h2>
      <p>{current.policy?.idleDays ?? 7}日間使わなかった端末は、自動でログアウトします。全ユーザー共通で{current.policy?.maxConcurrentSessions ?? 1}台まで利用できます。</p>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {sessions.map((s) => <article className="session-device" key={s.sessionId}>
        <h3>{s.deviceLabel}{s.sessionId === current.session?.sessionId ? "（この端末）" : ""}</h3>
        <p>最終利用：{new Date(s.lastActivityAt).toLocaleString("ja-JP")}</p>
        <p>{s.revokedAt ? LOGOUT_MESSAGES[s.revokeReason ?? ""] ?? "ログアウト済み" : s.isSharedDevice ? "共用端末・無操作で画面ロック" : "個人用端末"}</p>
        {!s.revokedAt && <button className="btn btn--small" disabled={busy} onClick={() => act(() => revoke(s.sessionId))}>このセッションをログアウト</button>}
      </article>)}
      <button className="btn" disabled={busy} onClick={() => act(() => logoutSession(true))}>全端末からログアウト</button>
      <section className="session-device"><h2>共用端末の保護</h2><p>無操作で画面をロックし、授業終了時刻にログアウトします。一度設定すると、このセッションでは保護を解除・延長できません。</p>
        <label className="field">授業終了時刻<input aria-label="授業終了時刻" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button className="btn" disabled={busy} onClick={() => act(shared)}>この端末を共用端末として設定</button>
      </section>
      <section className="session-device"><h2>音声の登録情報</h2><p>各自の端末で登録した声の特徴を、このGoogleアカウントから削除します。次回は再登録が必要です。</p><button className="btn" onClick={async () => { try { await sessionRequest("/voice-profile/delete", "POST", {}); window.alert("音声の登録情報を削除しました。"); } catch { window.alert("削除できませんでした。接続を確認してください。"); } }}>音声登録を削除する</button></section><SchoolSecurity />
      <h2 className="t-md">この端末に保管した録音</h2><p>このブラウザ内の、ご本人の録音だけを表示します。送信前に自動削除しません。共用端末では確認後に録音を削除してください。同じ端末を使う人が音声を見られる場合があります。</p>
      {recordings.map((r) => <article key={r.id} className="session-device"><h3>{new Date(r.createdAt).toLocaleString("ja-JP")}</h3><p>{r.complete ? "保存済み" : "途中保存・単体で再生できるとは限りません"}・{r.chunks}チャンク</p>
        {r.complete && <button className="btn" disabled={busy} onClick={() => act(async () => { const blob = await recoveryAudio(current.user!.uid, r.id); setAudio(URL.createObjectURL(blob)); })}>再生・ダウンロード</button>}
        {r.complete && r.roomId && <button className="btn" disabled={busy} onClick={() => act(async () => { await uploadRecording(r.roomId!, await recoveryAudio(current.user!.uid, r.id), (r.durationMs ?? 1000) / 1000); setError("送信しました。録音は端末にも残しています。"); })}>同じ部屋へ再送する</button>}
        <button className="btn" disabled={busy} onClick={() => { if (window.confirm("この端末の録音を削除します。送信済みか確認してください。")) void act(async () => { await deleteRecovery(current.user!.uid, r.id); setAudio(undefined); await load(); }); }}>この端末の録音を削除</button>
      </article>)}
      {audio && <div><audio controls src={audio} /><a className="btn" href={audio} download="discussion-audio">音声を保存</a></div>}
    </section></div>
  </main>;
}
