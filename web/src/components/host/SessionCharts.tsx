import type { CSSProperties } from "react";
import type { SpeakingState } from "@/components/Speaking";

const SPEAKING_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

/** 未取得を0%と混同せず、APIから届いた割合だけを描く。 */
export function ProgressRing({ label, value, note }: { label: string; value: number | null; note?: string }) {
  const percent = value == null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return <div className="dashboard-ring-stat">
    <div className="dashboard-ring" style={{ "--percent": percent ?? 0 } as CSSProperties} role="img" aria-label={`${label}：${percent == null ? "集計待ち" : `${percent}%`}`}>
      <strong>{percent == null ? "—" : `${percent}%`}</strong>
    </div>
    <div><h3>{label}</h3><p className="t-note">{note || (percent == null ? "集計待ち" : "")}</p></div>
  </div>;
}

export function SpeechBars({ state, names = [] }: { state?: SpeakingState; names?: string[] }) {
  const total = state ? Object.values(state.talkMs).reduce((a, b) => a + b, 0) + state.unknownMs : 0;
  const people = state?.members.length ? state.members : names.map((label, i) => ({ uid: String(i), label }));
  return <div className="dashboard-speech" aria-label="発言の割合（推定）">
    <p className="t-note">発言の割合（推定）{state?.source === "mock" && " · デモデータ"}</p>
    <div className="dashboard-speech__rows">{people.map((p, i) => {
      const value = total ? Math.round((state?.talkMs[p.uid] ?? 0) / total * 100) : null;
      return <div className="dashboard-speech__row" key={p.uid}>
        <span className="dashboard-speech__name">{p.label}</span><span className="dashboard-speech__track" aria-hidden="true"><span style={{ width: `${value ?? 0}%`, background: SPEAKING_COLORS[i % SPEAKING_COLORS.length] }} /></span><span>{value == null ? "—" : `${value}%`}</span>
      </div>;
    })}</div>
    {!!state?.unknownMs && <p className="t-note">判別不能 {Math.round(state.unknownMs / total * 100)}%</p>}
    {!total && !!people.length && <p className="t-note">録音開始後にグラフを表示</p>}
  </div>;
}
