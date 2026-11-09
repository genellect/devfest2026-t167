"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { SourceTag } from "@/components/ui";
import { FlowTimeline } from "@/components/flow";
import type { SpeakingState } from "@/components/Speaking";
import { useRoomFeed } from "@/lib/room-stream";
import type { Flow } from "@/lib/room";

/**
 * 先生のグループ別の分析の「議論の流れとメンバー別の発言率」（Figma「最新」T2 182:568）。
 * 1人1本の線で、直前2分間のグループの発話に占める割合を描き、その真下に同じ時間軸で議論の流れ（話題の帯）を並べる。
 * 色は dataviz の検証スクリプトで確かめた順（青・橙…）。Figma の青と紫は色覚の違いで見分けにくいので、2本目を橙にした。
 * 色だけに頼らず、凡例・表でも同じ値を出す。話者の集計がまだないときは、議論の流れだけを出す。
 */
const COLORS = ["#0b57d0", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const H = 210, PAD = { top: 12, right: 16, bottom: 26, left: 40 };

export function MemberFlow({ roomId, group, flow }: { roomId: string; group: number; flow: Flow | null }) {
  const docs = useRoomFeed(roomId).collections[`sessions/${roomId}/speaking`] ?? [];
  const state = docs.find((d) => d.id === String(group)) as unknown as SpeakingState | undefined;
  if (!state?.timeline || state.timeline.length < 2 || !state.members?.length) return <FlowTimeline flow={flow} />;
  return <Chart state={state} flow={flow && flow.speechDetected !== false ? flow : null} />;
}

function Chart({ state, flow }: { state: SpeakingState; flow: Flow | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 9人以上でも全員を描く（色は8色をくり返さず、9人目からは灰色の点線にする）
  const series = useMemo(() => {
    const timeline = state.timeline ?? [];
    const totals = timeline.map((m) => Object.values(m.talkMs ?? {}).reduce((a, b) => a + b, 0) + (m.unknownMs ?? 0));
    return state.members.map((m, k) => ({
      id: m.uid, label: m.label, color: COLORS[k] ?? "#8f8e89", dashed: k >= COLORS.length,
      values: timeline.map((t, i) => {
        const prev = timeline[i - 1], total = totals[i] + (i ? totals[i - 1] : 0);
        const mine = (t.talkMs?.[m.uid] ?? 0) + (prev?.talkMs?.[m.uid] ?? 0);
        return total ? (mine / total) * 100 : 0;
      }),
    }));
  }, [state]);
  const xs = (state.timeline ?? []).map((_, i) => Math.min(i + 1, Math.max(state.processedMs / 60_000, i + 0.02)));

  const segments = flow?.segments ?? [];
  const flowMinutes = segments.reduce((a, s) => a + s.minutes, 0);
  const maxX = Math.max(xs[xs.length - 1], flowMinutes, 1);
  const equal = state.members.length > 1 ? 100 / state.members.length : null;
  const top = Math.min(100, Math.max(60, Math.ceil((Math.max(...series.flatMap((s) => s.values), equal ?? 0) + 5) / 20) * 20));
  const plotW = width - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + (v / maxX) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  let acc = 0;
  const bands = segments.map((s) => { const b = { ...s, start: acc }; acc += s.minutes; return b; });
  const bounds = bands.slice(1).map((b) => b.start);
  const ticks = minuteTicks(maxX);
  const topicAt = (minute: number) => bands.find((b) => minute >= b.start && minute < b.start + b.minutes)?.topic;
  const nearest = (clientX: number, rect: DOMRect) => {
    const v = ((clientX - rect.left) / rect.width * width - PAD.left) / plotW * maxX;
    return xs.reduce((b, p, i) => (Math.abs(p - v) < Math.abs(xs[b] - v) ? i : b), 0);
  };

  return (
    <section className="panel member-flow" aria-labelledby="member-flow-title">
      <div className="heading-row">
        <h2 id="member-flow-title" className="member-flow__title">議論の流れとメンバー別の発言率</h2>
        {flow ? <SourceTag source={flow.source} /> : <span className="tag">推定</span>}
      </div>
      <div ref={box} className="speak-chart__plot">
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" tabIndex={0}
          aria-label={`メンバー別の発言率の推移（${series.map((s) => s.label).join("、")}）。値は下の表にもあります。左右の矢印キーで時点を移動できます。`}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? xs.length - 1)} onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); setActive((a) => Math.max(0, (a ?? xs.length) - 1)); }
            if (e.key === "ArrowRight") { e.preventDefault(); setActive((a) => Math.min(xs.length - 1, (a ?? -1) + 1)); }
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
            <text x={PAD.left + plotW * 0.3} y={y(equal) + 14} className="speak-chart__axis flow-speak__halo">均等な場合 {Math.round(equal)}%</text>
          </>}
          {ticks.map((t) => <text key={t} x={x(t)} y={H - 8} className="speak-chart__axis" textAnchor={t === 0 ? "start" : t >= maxX ? "end" : "middle"}>{t}分</text>)}
          {active !== null && <line x1={x(xs[active])} x2={x(xs[active])} y1={PAD.top} y2={PAD.top + plotH} className="speak-chart__cross" />}
          {series.map((s) => (
            <path key={s.id} d={s.values.map((v, i) => `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join("")}
              fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "4 3" : undefined} />
          ))}
          {active !== null && series.map((s) => <circle key={s.id} cx={x(xs[active])} cy={y(s.values[active])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />)}
        </svg>
        {active !== null && (
          <div className="speak-chart__tip" style={{ left: Math.min(Math.max(x(xs[active]), 80), width - 80) }} role="status">
            <p className="speak-chart__tip-head">{fmt(xs[active])}まで（直前2分）{topicAt(xs[active] - 0.5) ? `・${topicAt(xs[active] - 0.5)}` : ""}</p>
            {series.map((s) => <p key={s.id}><svg width="14" height="6" aria-hidden="true"><line x1="1" y1="3" x2="13" y2="3" stroke={s.color} strokeWidth="2" /></svg><strong>{Math.round(s.values[active])}%</strong> {s.label}</p>)}
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
      <ul className="member-flow__legend" aria-label="凡例">
        {series.map((s) => <li key={s.id}><span className="member-flow__dot" style={{ background: s.color }} aria-hidden="true" />{s.label}</li>)}
      </ul>
      {!flow && <p className="t-note">議論の流れは、録音の分析が届くと、このグラフの下に並びます。</p>}
      <details className="speak-chart__table">
        <summary>表で見る</summary>
        <div className="speak-chart__scroll">
          <table>
            <thead><tr><th scope="col">時点</th>{series.map((s) => <th key={s.id} scope="col">{s.label}</th>)}<th scope="col">話題</th></tr></thead>
            <tbody>{xs.map((xv, i) => <tr key={i}><th scope="row">{fmt(xv)}</th>{series.map((s) => <td key={s.id}>{Math.round(s.values[i])}%</td>)}<td>{topicAt(xv - 0.5) ?? "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className="t-note">推定値です。評価には使いません。</p>
    </section>
  );
}

/**
 * グループメンバー（Figma T2 の下）。名前と、グラフの線と同じ色だけを並べる。
 * 名前の横に発言率の数字を並べると、個人の点数のように見えるので出さない（Docs「アプリの構想」⑦ 個人を安易にスコア化しない）。
 * 発言率の推移は、上のグラフと「表で見る」にある。
 */
export function MemberList({ roomId, group }: { roomId: string; group: number }) {
  const docs = useRoomFeed(roomId).collections[`sessions/${roomId}/speaking`] ?? [];
  const state = docs.find((d) => d.id === String(group)) as unknown as SpeakingState | undefined;
  if (!state?.members?.length) return null;
  return (
    <section className="panel member-list" aria-labelledby="member-list-title">
      <h2 id="member-list-title" className="member-flow__title">グループメンバー</h2>
      <ul className="member-list__rows">
        {state.members.map((m, k) => (
          <li key={m.uid} className="member-list__row">
            <span className="member-list__avatar" style={{ background: COLORS[k] ?? "#8f8e89" }} aria-hidden="true">{m.label.slice(0, 1)}</span>
            <span className="member-list__name">{m.label}</span>
          </li>
        ))}
      </ul>
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
