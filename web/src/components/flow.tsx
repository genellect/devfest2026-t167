"use client";
import { SourceTag, Tag } from "@/components/ui";
import { useDoc, type Flow } from "@/lib/room";

/**
 * 音声の分析がまだ届いていないときに、デモでだけ出す見本。
 * テーマに依存しない一般的な内容にし、画面では必ず「デモデータ」と表示する。
 */
const DEMO_FLOW: Flow = {
  totalMinutes: 20,
  segments: [
    { topic: "意見の出し合い", minutes: 6 },
    { topic: "理由の深掘り", minutes: 7 },
    { topic: "テーマから脱線", minutes: 3, highlight: true },
    { topic: "まとめ", minutes: 4 },
  ],
  flowNote: "脱線した話から、別の見方が出てきました。脱線が悪かったかは、グループで確かめます。",
  good: [{ at: "6分ごろ", text: "別の見方を出して、話題を広げました。" }],
  review: [{ at: "12分ごろ", text: "ここで事前の意見を話せたかもしれません。", question: "もしこのとき「どう思う？」と聞かれていたら、何と答える？" }],
  source: "mock",
};

/** グループの議論の分析。本物があればそれを、なければデモのときだけ見本を返す */
export function useFlow(roomId: string, group: number | undefined, geminiSource: string | undefined) {
  const { data } = useDoc<Flow>(group ? `rooms/${roomId}/results/flow-g${group}` : undefined);
  if (data) return { flow: data, demo: false };
  if (geminiSource === "mock") return { flow: DEMO_FLOW, demo: true };
  return { flow: null, demo: false };
}

const PENDING = "音声の分析が届くと、ここに表示されます。";

/** 議論の流れ（話題ごとの時間の帯） */
export function FlowTimeline({ flow, compact }: { flow: Flow | null; compact?: boolean }) {
  const total = flow ? flow.segments.reduce((a, s) => a + s.minutes, 0) || 1 : 1;
  return (
    <section className="box box--md pad stack">
      <div className="heading-row">
        <h3 className={compact ? "t-sm" : "t-md"}>議論の流れ{flow ? `（${flow.totalMinutes}分）` : ""}</h3>
        {flow && <SourceTag source={flow.source} />}
      </div>
      {!flow ? <p className="empty">{PENDING}</p> : (
        <>
          <div className={`timeline${compact ? "" : " timeline--tall"}`} role="img" aria-label={flow.segments.map((s) => `${s.topic} ${s.minutes}分`).join("、")}>
            {flow.segments.map((s, i) => (
              <div key={i} className={`timeline__seg${s.highlight ? " timeline__seg--hl" : ""}`} style={{ flexGrow: s.minutes, "--share": s.minutes / total } as React.CSSProperties}>
                <span>{s.topic}</span><span>{s.minutes}分</span>
              </div>
            ))}
          </div>
          {flow.flowNote && <p className="t-note">{flow.flowNote}</p>}
        </>
      )}
    </section>
  );
}

/** ここがよかった／ここを見直そう */
export function GoodReview({ flow }: { flow: Flow | null }) {
  if (!flow) {
    return (
      <div className="row">
        <section className="box box--md pad stack"><Tag tone="blue">ここがよかった</Tag><p className="empty">{PENDING}</p></section>
        <section className="box box--md pad stack"><Tag tone="yellow">ここを見直そう</Tag><p className="empty">{PENDING}</p></section>
      </div>
    );
  }
  return (
    <div className="row">
      <section className="box box--md pad stack">
        <div className="heading-row"><span><Tag tone="blue">ここがよかった</Tag></span><SourceTag source={flow.source} /></div>
        {flow.good.map((g, i) => (
          <div key={i} className="stack stack--tight">
            <p className="t-small" style={{ fontWeight: 700 }}>{g.at}の発言</p>
            <p className="t-md">{g.text}</p>
          </div>
        ))}
      </section>
      <section className="box box--md pad stack">
        <div className="heading-row"><span><Tag tone="yellow">ここを見直そう</Tag></span><SourceTag source={flow.source} /></div>
        {flow.review.map((r, i) => (
          <div key={i} className="stack stack--tight">
            <p className="t-small" style={{ fontWeight: 700 }}>{r.at}の場面</p>
            <p className="t-md">{r.text}</p>
            {r.question && <p className="box box--yellow" style={{ padding: "10px 14px" }}>{r.question}</p>}
          </div>
        ))}
      </section>
    </div>
  );
}
