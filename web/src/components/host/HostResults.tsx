"use client";
import { useState } from "react";
import { FlowTimeline, GoodReview, useFlow } from "@/components/flow";
import { SourceTag, Tag } from "@/components/ui";
import { callApi } from "@/lib/api";
import { formatMetric } from "@/lib/format";
import { useDoc, type Coverage, type GroupResult, type Room, type Summary } from "@/lib/room";

const describeGap = (clusters: { count: number }[] | undefined) =>
  !clusters || clusters.length === 0 ? "回答なし" : clusters.length === 1 ? "大きなちがいなし" : `理解が${clusters.length}通り`;

/** 終了後：結論の一文の回収状況と、合意のずれ・4つの指標をまとめる操作 */
export function ConsensusProgress({ roomId, room, results, summary }: { roomId: string; room: Room; results: GroupResult[]; summary: Summary | null }) {
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState("");
  const groupCount = room.groups ?? 1;
  const running = room.consensusAnalysis?.status === "running";
  async function run(path: string, body: object, key: string) {
    setBusy(key); setMessage("");
    try { await callApi(`/rooms/${roomId}/${path}`, body); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(undefined); }
  }
  return (
    <div className="body">
      <section className="box box--lg pad stack" aria-label="結論の一文の回収">
        <h2 className="t-md">結論の一文</h2>
        <ul className="stack stack--tight" style={{ margin: 0, paddingLeft: 20 }}>
          {Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
            const st = room.groupState?.[String(g)];
            const done = results.some((r) => r.group === g);
            return <li key={g} className="t-label">グループ{g}：{done ? "結果あり" : `提出 ${st?.submitted ?? 0}/${st?.total ?? 0}人`}
              {!done && (st?.submitted ?? 0) > 0 && <button className="btn btn--small" style={{ marginLeft: 12 }} disabled={!!busy} onClick={() => void run("groups/analyze", { group: g }, `g${g}`)}>{busy === `g${g}` ? "分析しています…" : "今の回答で結果を出す"}</button>}
            </li>;
          })}
        </ul>
        <button className="btn btn--blue" disabled={!!busy || running || results.length === 0} onClick={() => void run("consensus/analyze", {}, "all")}>
          {busy === "all" || running ? "まとめています…" : summary ? "結果をまとめ直す" : "結果をまとめる"}
        </button>
        <p className="t-small">全グループの結論の一文から、理解のずれと4つの指標をまとめます。</p>
        {message && <p className="notice notice--warn" role="alert">{message}</p>}
      </section>
    </div>
  );
}

/** T1 セッション全体の結果。グループの結果を並べて比べる。指標は分かるものだけ出す */
export function ClassResult({ roomId, room, results, summary, onOpen }: { roomId: string; room: Room; results: GroupResult[]; summary: Summary | null; onOpen: (g: number) => void }) {
  const coverage = useDoc<Coverage>(`sessions/${roomId}/results/coverage`).data;
  const respondents = results.reduce((a, r) => a + r.respondents, 0);
  const largest = results.reduce((a, r) => a + Math.max(0, ...r.clusters.map((c) => c.count)), 0);
  const split = results.filter((r) => r.clusters.length > 1).length;
  const source = results[0]?.source ?? summary?.source;
  const signals: { title: string; note: string; value: number | null }[] = [
    { title: "認識一致度", note: "グループごとに、最も多い理解に入った人の割合", value: respondents >= 2 ? largest / respondents : null },
    { title: "意見の反映率", note: "事前意見の論点のうち、議論で取り上げられた割合", value: summary?.metrics.reflectionRate ?? coverage?.reflectionRate ?? null },
    { title: "介入の有効率", note: "承認した提案のうち、その後に取り上げられた割合", value: summary?.metrics.interventionEffectiveness ?? null },
  ];
  const groupCount = room.groups ?? 1;
  return (
    <div className="body">
      <div className="split split--result">
        <div className="stack" style={{ gap: 20 }}>
          <section className="box box--lg box--blue pad stack">
            <div className="heading-row"><p className="t-label">次の授業で扱えそうなこと</p><SourceTag source={source} /></div>
            <p className="t-lg" style={{ lineHeight: 1.4 }}>{split > 0 ? "結論の言葉を、全員でそろえる" : results.length ? "結論の理由を、さらに深める" : "結果を待っています"}</p>
            <p className="t-label">
              {split > 0
                ? `${results.length}グループ中${split}グループで、同じ結論の理解が分かれました。次の授業の始めに「私たちの結論は何のため？」を5分話し合います。`
                : results.length ? "結論の理解はそろっていました。次は、結論を支える理由を一人ひとりが説明できるか確かめます。" : "グループの全員が結論を書くと、ここにまとめが出ます。"}
            </p>
          </section>
          {signals.map((s) => (
            <section key={s.title} className={`box box--sm${s.value !== null && s.value < 0.5 ? " box--pink" : ""}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 17 }}>{s.title}</p>
                <p className="t-small">{s.note}</p>
              </div>
              <p className="t-lg" style={{ whiteSpace: "nowrap" }}>{s.value === null ? <span className="t-small">データなし</span> : `${Math.round(s.value * 100)}%`}</p>
            </section>
          ))}
          <p className="t-small">{source === "mock" ? "数値はデモデータです。" : "数値には Gemini による推定を含みます。"}実測の改善効果とは区別してください。</p>
        </div>
        <section className="box box--lg pad stack">
          <h2 className="t-md">グループを比べる</h2>
          <table className="table table--stack">
            <thead><tr><th>グループ</th><th>認識のちがい</th><th>一致度</th><th>回答</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
                const r = results.find((x) => x.group === g);
                return (
                  <tr key={g}>
                    <td className="table__head">グループ{g}</td>
                    <td data-label="認識のちがい">{!r ? "結果待ち" : r.clusters.length > 1 ? <span className="mark">{describeGap(r.clusters)}</span> : describeGap(r.clusters)}</td>
                    <td data-label="一致度">{r ? formatMetric(r.alignmentRate) : "—"}</td>
                    <td data-label="回答">{r ? `${r.respondents}人` : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r && <button className="btn btn--small" onClick={() => onOpen(g)}>詳しく見る</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/** T2 グループの話し合い。理解の分かれ方、議論の流れ、ここがよかった／ここを見直そう */
export function GroupResultView({ result, group, roomId }: { result: GroupResult | null; group: number; roomId: string; source?: string }) {
  const clusters = [...(result?.clusters ?? [])].sort((a, b) => b.count - a.count);
  const { flow } = useFlow(roomId, group);
  return (
    <div className="body">
      <section className="box box--lg box--yellow pad stack">
        <div className="heading-row"><h2 className="t-label">結論の認識のちがい</h2>{result && <SourceTag source={result.source} />}</div>
        <p className="t-md">{!result ? "このグループの結果はまだありません。" : clusters.length > 1 ? `同じ結論の理解が、${clusters.length}通りに分かれました。` : "結論の理解は、ほぼそろっていました。"}</p>
        <div className="row">
          {clusters.map((c, i) => (
            <div key={i} className="box pad stack stack--tight">
              <p className="t-sm">{c.label}</p>
              <span><Tag tone="tint">{c.count}人の入力</Tag></span>
            </div>
          ))}
        </div>
      </section>
      <FlowTimeline flow={flow} />
      <GoodReview flow={flow} />
      {flow && (flow.teacherSuggestions?.length || flow.review[0]?.question) && (
        <section className="box box--lg box--blue pad stack">
          <div className="heading-row"><h2 className="t-label">次の支援の案</h2><SourceTag source={flow.source} /></div>
          <p className="t-md">{clusters.length > 1 ? "結論の目的を、次の議論の最初に確認する" : "見直したい場面を、次の議論の最初に振り返る"}</p>
          {flow.teacherSuggestions?.length
            ? <ul className="stack stack--tight" style={{ margin: 0, paddingLeft: 20 }}>{flow.teacherSuggestions.map((t, i) => <li key={i} className="t-label">{t}</li>)}</ul>
            : <p className="t-label">問い：{flow.review[0].question}</p>}
        </section>
      )}
    </div>
  );
}
