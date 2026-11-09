"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { SourceTag } from "@/components/ui";
import { FlowTimeline } from "@/components/flow";
import { GuestSpeaking, type SelfSpeaking } from "@/components/Speaking";
import { useDoc, type Flow } from "@/lib/room";

/**
 * 「議論の流れとあなたの発言率」（Figma「最新」P5 の 182:1576 / スマホ 199:44）。
 * 本人の発言率の折れ線の真下に、同じ時間軸で議論の流れ（話題ごとの帯）を並べ、いつ何を話していたときに割合が変わったかを見せる。
 * 発言率は「その2分間のグループの発話のうち、本人が話した割合」。1分ごとだと相づち1回で大きく揺れるので、直前の1分と合わせて平らにする。
 * 音声の分析（議論の流れ）や本人の集計がまだないときは、これまでどおり議論の流れだけを出す。
 */
const LINE = "#1760df", H = 210, PAD = { top: 12, right: 16, bottom: 26, left: 40 };
const DROP = 15; // これ以上下がったら「低下」として示す（ポイント）

export function FlowSpeaking({ roomId, group, flow }: { roomId: string; group: number; flow: Flow | null }) {
  const { data } = useDoc<SelfSpeaking | Record<string, unknown>>(`sessions/${roomId}/speaking/${group}`);
  const self = data && (data as SelfSpeaking).scope === "self" ? data as SelfSpeaking : null;
  if (!self || !self.members.length) return <FlowTimeline flow={flow} compact />;
  // 推移の点がそろう前でも、すでに測定した本人の発言時間・割合は結果に出す。
  if ((self.timeline?.length ?? 0) < 2) return <><GuestSpeaking roomId={roomId} group={group} /><FlowTimeline flow={flow} compact /></>;
  return <Card self={self} flow={flow && flow.speechDetected !== false ? flow : null} />;
}

function Card({ self, flow }: { self: SelfSpeaking; flow: Flow | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const own = useMemo(() => new Set(self.members.map((m) => m.uid)), [self.members]);
  const { points, overall } = useMemo(() => {
    const per = self.timeline.map((m) => ({ own: Object.entries(m.talkMs).reduce((a, [id, ms]) => a + (own.has(id) ? ms : 0), 0), total: m.totalMs ?? 0 }));
    const points = per.map((p, i) => {
      const prev = per[i - 1] ?? { own: 0, total: 0 };
      const total = p.total + prev.total;
      return { x: Math.min(i + 1, Math.max(self.processedMs / 60_000, i + 0.02)), v: total ? ((p.own + prev.own) / total) * 100 : 0 };
    });
    const ownAll = per.reduce((a, p) => a + p.own, 0);
    return { points, overall: self.totalMs ? (ownAll / self.totalMs) * 100 : 0 };
  }, [self, own]);

  const segments = flow?.segments ?? [];
  const flowMinutes = segments.reduce((a, s) => a + s.minutes, 0);
  const maxX = Math.max(points[points.length - 1].x, flowMinutes, 1);
  const equal = self.memberCount > 1 ? 100 / self.memberCount : null;
  const top = Math.min(100, Math.max(60, Math.ceil((Math.max(...points.map((p) => p.v), equal ?? 0) + 5) / 20) * 20));
  const peak = points.reduce((a, p) => (p.v > a.v ? p : a), points[0]);
  // いちばん大きく下がった区間：下がり続けた区間（山 → 谷）のうち、下げ幅が最大のもの
  let d: { from: number; to: number; start: number; i: number } | null = null;
  for (let i = 1, start = 0; i < points.length; i++) {
    if (points[i].v >= points[i - 1].v) { start = i; continue; }
    const fall = points[start].v - points[i].v;
    if (fall >= DROP && (!d || fall > d.from - d.to)) d = { from: points[start].v, to: points[i].v, start, i };
  }
  const dropStart = d ? Math.round(points[d.start].x) : 0, dropEnd = d ? Math.round(points[d.i].x) : 0;
  const topicAt = (minute: number) => { let acc = 0; for (const s of segments) { if (minute < acc + s.minutes) return s.topic; acc += s.minutes; } return undefined; };
  const dropTopic = d ? topicAt((dropStart + dropEnd) / 2) : undefined;

  const plotW = width - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + (v / maxX) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = minuteTicks(maxX);
  const bounds = segments.reduce<number[]>((a, s) => [...a, (a.at(-1) ?? 0) + s.minutes], []).slice(0, -1);
  let acc = 0;
  const bands = segments.map((s) => { const b = { ...s, start: acc }; acc += s.minutes; return b; });
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const nearest = (clientX: number, rect: DOMRect) => {
    const v = ((clientX - rect.left) / rect.width * width - PAD.left) / plotW * maxX;
    return points.reduce((b, p, i) => (Math.abs(p.x - v) < Math.abs(points[b].x - v) ? i : b), 0);
  };
  const headline = d
    ? `${dropStart}〜${dropEnd}分ごろ${dropTopic ? `、${dropTopic}の前後で` : "に"}、発言の割合が下がりました。`
    : `発言の割合は、議論のあいだ大きくは変わりませんでした。`;

  return (
    <section className="box box--md pad stack flow-speak" aria-labelledby="flow-speak-title">
      <div className="heading-row">
        <h3 id="flow-speak-title" className="t-sm">議論の流れとあなたの発言率</h3>
        {flow ? <SourceTag source={flow.source} /> : <span className="tag">推定</span>}
      </div>
      <p className="flow-speak__lead">{headline}</p>

      <div ref={box} className="speak-chart__plot">
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" tabIndex={0}
          aria-label={`あなたの発言率の推移。${headline}値は下の表にもあります。左右の矢印キーで時点を移動できます。`}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? points.length - 1)} onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); setActive((a) => Math.max(0, (a ?? points.length) - 1)); }
            if (e.key === "ArrowRight") { e.preventDefault(); setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1)); }
          }}>
          {bands.filter((b) => b.highlight).map((b, i) => <rect key={i} x={x(b.start)} y={PAD.top} width={x(b.start + b.minutes) - x(b.start)} height={plotH} className="flow-speak__band" />)}
          {Array.from({ length: top / 20 + 1 }, (_, i) => i * 20).map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} className="speak-chart__grid" />
              <text x={PAD.left - 6} y={y(v)} className="speak-chart__axis" textAnchor="end" dominantBaseline="middle">{v}%</text>
            </g>
          ))}
          {bounds.map((b) => <line key={b} x1={x(b)} x2={x(b)} y1={PAD.top} y2={PAD.top + plotH} className="flow-speak__phase" />)}
          {equal !== null && <>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(equal)} y2={y(equal)} className="flow-speak__equal" />
            <text x={PAD.left + plotW - 4} y={y(equal) - 6} className="speak-chart__axis flow-speak__halo" textAnchor="end">均等な場合 {Math.round(equal)}%</text>
          </>}
          {ticks.map((t) => <text key={t} x={x(t)} y={H - 8} className="speak-chart__axis" textAnchor={t === 0 ? "start" : t >= maxX ? "end" : "middle"}>{t}分</text>)}
          {active !== null && <line x1={x(points[active].x)} x2={x(points[active].x)} y1={PAD.top} y2={PAD.top + plotH} className="speak-chart__cross" />}
          <path d={path} fill="none" stroke={LINE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {d && <>
            <circle cx={x(points[d.i].x)} cy={y(d.to)} r="4" fill={LINE} stroke="#fff" strokeWidth="2" />
            <text x={Math.min(x(points[d.i].x) + 8, PAD.left + plotW - 4)} y={PAD.top + 14} className="flow-speak__drop flow-speak__halo" textAnchor={x(points[d.i].x) + 120 > PAD.left + plotW ? "end" : "start"}>低下：{Math.round(d.from)}% → {Math.round(d.to)}%</text>
          </>}
          {active !== null && <circle cx={x(points[active].x)} cy={y(points[active].v)} r="4" fill={LINE} stroke="#fff" strokeWidth="2" />}
        </svg>
        {active !== null && (
          <div className="speak-chart__tip" style={{ left: Math.min(Math.max(x(points[active].x), 70), width - 70) }} role="status">
            <p className="speak-chart__tip-head">{fmt(points[active].x)}まで（直前2分）</p>
            <p><strong>{Math.round(points[active].v)}%</strong> あなた</p>
            {topicAt(points[active].x - 0.5) && <p>{topicAt(points[active].x - 0.5)}</p>}
          </div>
        )}
        {bands.length > 0 && (
          <div className="flow-speak__phases" style={{ marginLeft: PAD.left, marginRight: PAD.right }} aria-label="議論の流れ">
            {bands.map((b, i) => (
              <div key={i} title={`${b.topic} ${b.minutes}分`} className={`flow-speak__seg${b.highlight ? " flow-speak__seg--hl" : ""}`} style={{ left: `${(b.start / maxX) * 100}%`, width: `${(b.minutes / maxX) * 100}%` }}>
                <span>{b.topic}</span><span>{b.minutes}分</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {!flow && <p className="t-note">議論の流れは、録音の分析が届くと、このグラフの下に並びます。</p>}
      {flow?.flowNote && <p className="t-note">{flow.flowNote}</p>}

      <div className="flow-speak__stats">
        <div><p className="t-note">全体の発言率</p><p className="flow-speak__num">{Math.round(overall)}%</p></div>
        <div><p className="t-note">最も高い時間</p><p className="flow-speak__num">{Math.round(peak.x)}分ごろ {Math.round(peak.v)}%</p></div>
        <div><p className="t-note">低下した時間</p><p className="flow-speak__num">{d ? `${dropStart}〜${dropEnd}分` : "なし"}</p></div>
      </div>

      <details className="speak-chart__table">
        <summary>表で見る</summary>
        <div className="speak-chart__scroll">
          <table>
            <thead><tr><th scope="col">時点</th><th scope="col">あなたの発言率（直前2分）</th><th scope="col">話題</th></tr></thead>
            <tbody>{points.map((p, i) => <tr key={i}><th scope="row">{fmt(p.x)}</th><td>{Math.round(p.v)}%</td><td>{topicAt(p.x - 0.5) ?? "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className="t-note">発言量の多さを評価する指標ではありません。ほかの人の時間は表示しません。{d ? `${dropStart}分ごろ、何を考えていましたか。` : ""}</p>
    </section>
  );
}

function minuteTicks(max: number) {
  const step = max <= 8 ? 2 : max <= 25 ? 5 : 10;
  const out: number[] = [];
  for (let t = 0; t < max - step / 2; t += step) out.push(t);
  out.push(Math.round(max));
  return out;
}
const fmt = (v: number) => (Number.isInteger(v) ? `${v}分` : `${Math.floor(v)}分${Math.round((v % 1) * 60)}秒`);
