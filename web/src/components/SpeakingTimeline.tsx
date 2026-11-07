"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface SpeakingMinute { talkMs: Record<string, number>; unknownMs: number }

/**
 * 発言率の推移（折れ線）。横軸は録音開始からの分、縦軸は「その時点までの発話時間に占める割合」。
 * 1分ごとの割合は相づち1回で大きく揺れるので、累積の割合を描く。判別不能も1本の線として残す（分母に含める）。
 * 色だけで人を区別しないよう、凡例・線の端の名前・表の3つで同じ情報を出す。
 */
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const UNKNOWN = "#8f8e89";
const H = 220;

interface Series { id: string; label: string; color: string; dashed?: boolean; values: number[] }

export function SpeakingTimeline({ timeline, members, processedMs }: {
  timeline: SpeakingMinute[]; members: { uid: string; label: string }[]; processedMs: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { xs, series } = useMemo(() => {
    // 各分の終わり（最後の分は、録音した長さまで）での累積の割合
    const xs = timeline.map((_, i) => Math.min(i + 1, Math.max(processedMs / 60_000, i + 0.02)));
    const cum: Record<string, number> = {};
    let unknown = 0;
    const rows = timeline.map((m) => {
      for (const [uid, ms] of Object.entries(m.talkMs)) cum[uid] = (cum[uid] ?? 0) + ms;
      unknown += m.unknownMs;
      const total = Object.values(cum).reduce((a, b) => a + b, 0) + unknown;
      return { total, cum: { ...cum }, unknown };
    });
    const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);
    const series: Series[] = members.slice(0, COLORS.length).map((m, i) => ({
      id: m.uid, label: m.label, color: COLORS[i], values: rows.map((r) => pct(r.cum[m.uid] ?? 0, r.total)),
    }));
    if (rows.some((r) => r.unknown > 0)) series.push({ id: "unknown", label: "判別不能", color: UNKNOWN, dashed: true, values: rows.map((r) => pct(r.unknown, r.total)) });
    return { xs, series };
  }, [timeline, members, processedMs]);

  if (timeline.length < 2) return <p className="t-note">発言率の推移は、録音が2分を超えると表示されます。</p>;

  // 狭い画面では線の端の名前を出さず（凡例と表で読める）、描く幅を広く取る
  const endLabels = width >= 480 && series.length <= 5;
  const PAD = { top: 12, right: endLabels ? 132 : 16, bottom: 30, left: 40 };
  const w = width, plotW = w - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const maxX = xs[xs.length - 1];
  const x = (v: number) => PAD.left + (v / maxX) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / 100) * plotH;
  const ticks = niceMinutes(maxX);
  const path = (s: Series) => s.values.map((v, i) => `${i ? "L" : "M"}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join("");

  // 線の端の名前：近すぎて重なる名前は出さない（凡例と表で読める）
  const ends = series.map((s) => ({ s, y: y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
  const labeled = new Set<string>();
  let last = -Infinity;
  if (endLabels) for (const e of ends) if (e.y - last >= 14) { labeled.add(e.s.id); last = e.y; }

  const nearest = (clientX: number, rect: DOMRect) => {
    const v = ((clientX - rect.left) / rect.width * w - PAD.left) / plotW * maxX;
    let best = 0;
    xs.forEach((xv, i) => { if (Math.abs(xv - v) < Math.abs(xs[best] - v)) best = i; });
    return best;
  };
  const tip = active === null ? null : { i: active, left: x(xs[active]) };

  return (
    <figure className="speak-chart">
      <figcaption className="speak-chart__title">発言率の推移（推定）</figcaption>
      <ul className="speak-chart__legend" aria-label="凡例">
        {series.map((s) => (
          <li key={s.id}><svg width="18" height="8" aria-hidden="true"><line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={s.dashed ? "4 3" : undefined} /></svg>{s.label}</li>
        ))}
      </ul>
      <div ref={box} className="speak-chart__plot">
        <svg width={w} height={H} role="img" tabIndex={0}
          aria-label={`発言率の推移。録音開始から${Math.round(maxX)}分まで。値は下の表にもあります。左右の矢印キーで時点を移動できます。`}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? xs.length - 1)} onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); setActive((a) => Math.max(0, (a ?? xs.length) - 1)); }
            if (e.key === "ArrowRight") { e.preventDefault(); setActive((a) => Math.min(xs.length - 1, (a ?? -1) + 1)); }
          }}>
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} className="speak-chart__grid" />
              <text x={PAD.left - 6} y={y(v)} className="speak-chart__axis" textAnchor="end" dominantBaseline="middle">{v}%</text>
            </g>
          ))}
          {ticks.map((t) => <text key={t} x={x(t)} y={H - 10} className="speak-chart__axis" textAnchor="middle">{t}分</text>)}
          {tip && <line x1={tip.left} x2={tip.left} y1={PAD.top} y2={PAD.top + plotH} className="speak-chart__cross" />}
          {series.map((s) => (
            <path key={s.id} d={path(s)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
          ))}
          {tip && series.map((s) => <circle key={s.id} cx={tip.left} cy={y(s.values[tip.i])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />)}
          {series.filter((s) => labeled.has(s.id)).map((s) => {
            const vy = y(s.values[s.values.length - 1]);
            return <text key={s.id} x={x(maxX) + 8} y={vy} className="speak-chart__end" dominantBaseline="middle">{short(s.label)} {Math.round(s.values[s.values.length - 1])}%</text>;
          })}
        </svg>
        {tip && (
          <div className="speak-chart__tip" style={{ left: Math.min(Math.max(tip.left, 70), w - 70) }} role="status">
            <p className="speak-chart__tip-head">{formatMinute(xs[tip.i])}まで</p>
            {series.map((s) => (
              <p key={s.id}><svg width="14" height="6" aria-hidden="true"><line x1="1" y1="3" x2="13" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "3 2" : undefined} /></svg><strong>{Math.round(s.values[tip.i])}%</strong> {s.label}</p>
            ))}
          </div>
        )}
      </div>
      <details className="speak-chart__table">
        <summary>表で見る</summary>
        <div className="speak-chart__scroll">
          <table>
            <thead><tr><th scope="col">時点</th>{series.map((s) => <th key={s.id} scope="col">{s.label}</th>)}</tr></thead>
            <tbody>{xs.map((xv, i) => <tr key={i}><th scope="row">{formatMinute(xv)}</th>{series.map((s) => <td key={s.id}>{Math.round(s.values[i])}%</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className="t-note">その時点までの発話時間に占める割合です。無音は除き、判別できなかった時間も分母に含めます。</p>
    </figure>
  );
}

function niceMinutes(max: number) {
  const step = max <= 6 ? 1 : max <= 15 ? 3 : max <= 40 ? 5 : 10;
  const out: number[] = [];
  for (let t = 0; t <= max + 0.001; t += step) out.push(t);
  return out;
}
const formatMinute = (v: number) => (Number.isInteger(v) ? `${v}分` : `${Math.floor(v)}分${Math.round((v % 1) * 60)}秒`);
const short = (label: string) => (label.length > 7 ? `${label.slice(0, 6)}…` : label);
