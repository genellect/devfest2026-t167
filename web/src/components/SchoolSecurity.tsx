"use client";
import { useEffect, useState } from "react";
import { sessionRequest, useAppSession, type PolicyView } from "@/lib/session";
export function SchoolSecurity() {
  const { user } = useAppSession();
  const [school, setSchool] = useState<string>(), [policy, setPolicy] = useState<PolicyView>();
  const [target, setTarget] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void user?.getIdTokenResult().then(async ({ claims }) => {
      if (claims.schoolAdmin !== true || typeof claims.schoolId !== "string") return;
      const result = await sessionRequest<{ policy: PolicyView }>(`/schools/${encodeURIComponent(claims.schoolId)}/security-policy`);
      if (live) { setSchool(claims.schoolId); setPolicy(result.policy); }
    }).catch(() => { if (live) setMessage("学校の設定を確認できませんでした。"); });
    return () => { live = false; };
  }, [user]);
  if (!school || !policy) return null;
  async function save() {
    try { await sessionRequest(`/schools/${school}/security-policy`, "PUT", policy); setMessage("学校の設定を保存しました。端末の有効性確認時に適用します。同時ログイン上限は次回の新規ログインから適用します。"); }
    catch { setMessage("設定を保存できませんでした。入力と接続を確認してください。"); }
  }
  const fields = [
    ["idleDays", "未使用ログアウトまでの日数", 7], ["maxConcurrentSessions", "全ユーザーの同時ログイン上限", 10],
    ["sharedIdleMinutes", "共用端末の無操作ロック（分）", 15],
  ] as const;
  return <section className="session-device"><h2>学校のセキュリティ設定</h2><p>所属校の管理者だけが変更できます。MVPでは安全側の上限内に限ります。</p>
    {fields.map(([key, label, max]) => <label className="field" key={key}>{label}<input type="number" min={1} max={max} value={policy[key]} onChange={(e) => setPolicy({ ...policy, [key]: Number(e.target.value) })} /></label>)}
    <label><input type="checkbox" checked={policy.endAtClassEnd} onChange={(e) => setPolicy({ ...policy, endAtClassEnd: e.target.checked })} />授業終了時に共用セッションを終了</label>
    <label><input type="checkbox" disabled checked={policy.newDeviceNotifications} onChange={(e) => setPolicy({ ...policy, newDeviceNotifications: e.target.checked })} />新しい端末へのログイン通知（準備中）</label>
    <button className="btn" onClick={save}>学校の設定を保存</button>
    <label className="field">失効させる利用者の管理用ID<input value={target} onChange={(e) => setTarget(e.target.value)} autoComplete="off" /></label>
    <button className="btn" disabled={!/^[A-Za-z0-9_-]{1,128}$/.test(target)} onClick={async () => { try { await sessionRequest(`/schools/${school}/users/${target}/sessions/revoke`, "POST", {}); setMessage("対象の利用者のセッションを終了しました。"); } catch { setMessage("同じ学校の利用者か確認してください。"); } }}>管理者として全セッションを終了</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
