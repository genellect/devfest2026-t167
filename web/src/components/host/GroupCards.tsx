"use client";
import { useState } from "react";
import type { SpeakingState } from "@/components/Speaking";
import { callApi } from "@/lib/api";
import { isRecordingLive, type GroupConfig, type GroupResult, type Room } from "@/lib/room";

const BAR_COLORS = ["#0b57d0", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const STATUS: Record<string, { label: string; tone: string }> = {
  opinions: { label: "事前の意見を書いています", tone: "wait" },
  discussing: { label: "話し合い中", tone: "talk" },
  consensus: { label: "結論を記入中", tone: "write" },
  done: { label: "結果あり", tone: "done" },
};

/**
 * グループのカード（Figma「最新」182:445）。左の色の線と大きな文字で、いまの段階を一目で分かるようにする（アプリフィードバック「視線誘導」）。
 * 1本化した流れ（flowVersion 1）では、議論は教員が一斉に終えるので、段階は次のように分かれる。
 * - 議論中（ダッシュボード）：事前の意見を書いています／話し合い中。話し合い中は、メンバーの発言率（推定）の棒を出す
 * - 終了後：結論を記入中（今の回答で結果を出す）／結果あり（グループを見る）
 * 次にできる操作は1つだけボタンにする。結果が出たかは、グループの状態ではなく結果の文書で判定する。
 */
export function GroupCards({ roomId, room, groups, results, speaking = [], configs = [], now = Date.now(), onOpen, label = "グループ", overview = [] }: {
  roomId: string; room: Room; groups: number[]; results: GroupResult[]; speaking?: SpeakingState[]; configs?: GroupConfig[];
  now?: number; onOpen?: (group: number) => void; label?: string;
  /** 共有メモから Gemini がまとめた、グループごとの議論の軸と主な論点（#85。先生だけが読める） */
  overview?: { group: number; focus: string; points: string[] }[];
}) {
  const [busy, setBusy] = useState<number>(), [error, setError] = useState("");
  async function analyze(group: number) {
    setBusy(group); setError("");
    try { await callApi(`/rooms/${roomId}/groups/analyze`, { group }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(undefined); }
  }
  return (
    <section aria-label={label} className="group-cards-wrap">
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <ul className="group-cards">
        {groups.map((g) => {
          const st = room.groupState?.[String(g)] ?? {};
          const result = results.find((r) => r.group === g);
          const key = result ? "done" : st.status ?? "opinions";
          const status = STATUS[key] ?? STATUS.opinions;
          const sp = key === "discussing" ? speaking.find((s) => s.group === g || (s as unknown as { id?: string }).id === String(g)) : undefined;
          const config = configs.find((c) => c.number === g);
          const axis = overview.find((o) => o.group === g);
          const recorder = room.recording !== false && key === "discussing" && config?.recorderName
            ? isRecordingLive(config, now) ? `録音中：${config.recorderName}さん` : `録音担当：${config.recorderName}さん（録音していません）` : "";
          const sub = key === "consensus" ? `提出 ${st.submitted ?? 0}/${st.total ?? 0}人`
            : key === "done" ? `${result?.respondents ?? st.total ?? 0}人${result ? `・${result.clusters.length > 1 ? `理解が${result.clusters.length}通り` : "大きな違いなし"}` : ""}`
              : `${st.total ?? 0}人`;
          return (
            <li key={g} className="group-card2" data-tone={status.tone}>
              <div className="group-card2__main">
                <p className="group-card2__name">グループ{g}</p>
                <p className="group-card2__status">{status.label}</p>
                <p className="group-card2__sub">{[sub, recorder].filter(Boolean).join("・")}</p>
                {key === "discussing" && axis && <div className="group-card2__axis"><p><span className="group-card2__axis-label">議論の軸（AI）</span>{axis.focus}</p>{!!axis.points.length && <ul>{axis.points.map((p, k) => <li key={k}>{p}</li>)}</ul>}</div>}
                {key === "consensus" && (st.submitted ?? 0) > 0 && <button className="btn btn--small group-card2__action" disabled={busy !== undefined} onClick={() => void analyze(g)}>{busy === g ? "結果を出しています…" : "今の回答で結果を出す"}</button>}
                {key === "done" && onOpen && <button className="btn btn--small group-card2__action" onClick={() => onOpen(g)}>グループを見る</button>}
              </div>
              {sp && sp.members?.length > 0 && <Rates group={g} state={sp} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 話し合い中のメンバーの発言率（議論の開始からの割合・推定）。判別できなかった時間も1行にして、合計が100%になるようにする */
function Rates({ group, state }: { group: number; state: SpeakingState }) {
  const total = Object.values(state.talkMs ?? {}).reduce((a, b) => a + b, 0) + (state.unknownMs ?? 0);
  const pct = (ms: number) => (total ? Math.round((ms / total) * 100) : 0);
  const rows = state.members.map((m, k) => ({ key: m.uid, label: m.label, value: pct(state.talkMs?.[m.uid] ?? 0), color: BAR_COLORS[k % BAR_COLORS.length] }));
  if ((state.unknownMs ?? 0) > 0) rows.push({ key: "unknown", label: "判別不能", value: pct(state.unknownMs), color: "#a3a7ad" });
  return (
    <div className="group-card2__rates" aria-label={`グループ${group}の発言率（リアルタイム・推定）`}>
      <p className="group-card2__rates-title">発言率（リアルタイム・推定）</p>
      {rows.map((r) => (
        <div key={r.key} className="group-card2__rate" data-unknown={r.key === "unknown" || undefined}>
          <span className="group-card2__who">{r.label}</span>
          <span className="group-card2__track"><span style={{ width: `${r.value}%`, background: r.color }} /></span>
          <span className="group-card2__pct">{r.value}%</span>
        </div>
      ))}
    </div>
  );
}
