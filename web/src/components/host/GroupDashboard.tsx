"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SpeakingState } from "@/components/Speaking";
import styles from "./group-dashboard.module.css";
import { speechShares } from "./group-speaking";
import type { Flow } from "@/lib/room";
import { SourceTag } from "@/components/ui";

export interface GroupView {
  id: number; count: number; status: string; speaking?: SpeakingState;
  topic?: string;
  activity?: { label: string; segments: [number, number][] }[];
  flow?: Flow;
  analysisStatus?: "analyzing" | "done" | "failed";
}

export function GroupDashboard({ title, groups, timer, timerLabel = "残り時間", actions, details, pending = 0, status = "議論中" }: {
  title: string; groups: GroupView[]; timer?: string; timerLabel?: string; actions?: ReactNode;
  details?: (group: GroupView) => ReactNode; pending?: number; status?: string;
}) {
  const [selected, setSelected] = useState<number>(), [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const group = groups.find(g => g.id === selected);
  useEffect(() => {
    const element = dialog.current;
    if (!group || !element) return;
    if (!element.open) { element.scrollTop = 0; element.showModal(); element.querySelector<HTMLElement>("[data-detail-heading]")?.focus({ preventScroll: true }); }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selected !== undefined && !group) { dialog.current?.close(); setSelected(undefined); }
  }, [selected, group]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  function finishClose() { clearTimeout(closeTimer.current); dialog.current?.close(); }
  function close() {
    if (!dialog.current?.open || closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finishClose(); return; }
    setClosing(true); closeTimer.current = setTimeout(finishClose, 480);
  }
  const remaining = pending;
  return <div className={styles.root}>
    <section className={styles.overview} aria-label="グループ一覧">
      <div className={styles.heading}><div><p className={styles.theme}>{title}</p><h1>グループの状況</h1><p className={styles.live}><span />{status}{timer && <span className={styles.timer} role="timer" aria-label={timerLabel}>{timer}</span>}</p></div><div className={styles.actions}>{actions}</div></div>
      <dl className={styles.summary}><div><dt>議論中</dt><dd>{groups.filter(g => g.status === "議論中").length}<small>グループ</small></dd></div><div><dt>参加者</dt><dd>{groups.reduce((n, g) => n + g.count, 0)}<small>人</small></dd></div><div><dt>支援の提案</dt><dd>{remaining}<small>件</small></dd></div></dl>
      {!groups.length && <p className={styles.empty}>グループが作成されると、ここに表示されます。</p>}
      <div className={styles.grid}>{groups.map(g => {
        const shares = speechShares(g.speaking);
        return <button type="button" key={g.id} className={styles.groupCard} aria-haspopup="dialog" aria-label={`グループ${g.id}の詳細を開く`} onClick={e => { trigger.current = e.currentTarget; setClosing(false); setSelected(g.id); }}>
          <span className={styles.cardTitle}>グループ{g.id}<span aria-hidden="true">›</span></span>
          <span className={styles.cardMeta}><span className={styles.status}>{g.status}</span><span>{g.count}人</span>{g.speaking?.source && <span>{g.speaking.source === "mock" ? "音声モック" : "実モデル（推定）"}</span>}</span>
          <div className={styles.bar} aria-label={shares.total ? "発言時間の割合" : "発言データなし"}>{shares.total > 0 && shares.rows.map(r => <span key={r.id} style={{ width: `${r.percent}%`, background: r.color }} />)}</div>
          {shares.total > 0 ? <span className={styles.legend}>{shares.rows.map(r => <span key={r.id}><i style={{ background: r.color }} />{r.label} {Math.round(r.percent)}%</span>)}</span> : <span className={styles.empty}>発言データはまだありません</span>}
        </button>;
      })}</div>
      <p className={styles.footnote}>発言率：無音を除く発話時間の割合。話者認識による推定・判別不能を含みます。</p>
    </section>
    <dialog ref={dialog} className={styles.detail} data-closing={closing || undefined} aria-labelledby="group-detail-heading" onCancel={e => { e.preventDefault(); close(); }} onAnimationEnd={e => { if (closing && e.target === e.currentTarget && !e.pseudoElement) finishClose(); }} onClose={() => { clearTimeout(closeTimer.current); setSelected(undefined); setClosing(false); trigger.current?.focus({ preventScroll: true }); }}>
      {group && <>
        <header className={styles.detailHeader}><button type="button" className={styles.iconButton} aria-label="グループ一覧へ戻る" onClick={close}>‹</button><h2 id="group-detail-heading" tabIndex={-1} data-detail-heading>グループ{group.id}</h2><button type="button" className={styles.iconButton} aria-label="グループ詳細を閉じる" onClick={close}>×</button></header>
        <div className={styles.detailBody}><h3 className={styles.detailTheme}>{title}</h3><p className={styles.live}><span />{group.status}</p>
          <SpeechCard group={group} />
          <section className={styles.card}><h3>直近3分</h3>{group.activity ? <><div className={styles.activity}>{group.activity.map(row => <div key={row.label}><span>{row.label}</span><div>{row.segments.map(([from, to], i) => <i key={i} style={{ left: `${from / 180 * 100}%`, width: `${(to - from) / 180 * 100}%` }} />)}</div></div>)}</div><p className={styles.axis}>0:00<span>1:00</span><span>2:00</span><span>3:00</span></p></> : <p className={styles.empty}>区間ごとの発言履歴はまだ取得していません。</p>}</section>
          <section className={styles.card} hidden={!!group.flow}><h3>今の論点 {group.topic && <small>✦ AI推定</small>}</h3><p>{group.topic || "音声の内容分析はまだありません。"}</p></section>
          {group.flow ? <section className={styles.card} aria-label={`グループ${group.id}の録音分析`}>
            <h3>録音の分析 {group.flow.source ? <SourceTag source={group.flow.source} /> : <small>分析元未確認</small>}</h3>
            {group.flow.recordingMode === "personal" && <p className={styles.footnote}>{group.flow.recordingCount}台の録音を分析済みです。要約は端末ごと、時刻は各端末の録音開始からの目安です。</p>}
            {group.flow.speechDetected === false ? <p>人の声を検出できなかったため、内容の分析はありません。</p> : <>
              <p>{group.flow.flowNote || "要約はありません。"}</p>
              {!!group.flow.segments?.length && <><h4>議論の論点</h4><ul>{group.flow.segments.map((segment, i) => <li key={i}>{segment.topic}</li>)}</ul></>}
              {!!group.flow.good?.length && <><h4>よかった点</h4><ul>{group.flow.good.map((item, i) => <li key={i}>{item.at} {item.text}</li>)}</ul></>}
              {!!group.flow.review?.length && <><h4>次に試すこと</h4><ul>{group.flow.review.map((item, i) => <li key={i}>{item.at} {item.text}{item.question && <p>{item.question}</p>}</li>)}</ul></>}
              {!!group.flow.teacherSuggestions?.length && <><h4>ホストへの助言</h4><ul>{group.flow.teacherSuggestions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
            </>}
          </section> : <p role="status">{group.analysisStatus === "failed" ? "録音の分析に失敗しました。録音担当端末から再送できます。" : group.analysisStatus === "analyzing" ? "録音を分析しています。完了すると自動で表示します。" : "録音の内容分析は終了後に表示します。"}</p>}
          <div className={styles.analysis}>{details?.(group)}</div>
        </div>
      </>}
    </dialog>
  </div>;
}

function SpeechCard({ group }: { group: GroupView }) {
  const { rows, total } = speechShares(group.speaking);
  let edge = 0;
  const gradient = rows.filter(r => r.ms > 0).map(r => { const start = edge; edge += r.percent; return `${r.color} ${start}% ${edge}%`; }).join(",");
  return <section className={styles.card} aria-label={`グループ${group.id}の発言時間`}><h3>発言の状況 <small>{group.speaking?.source === "mock" ? "音声モック" : group.speaking?.source === "model" ? "実音声モデルによる推定" : "未取得"}</small></h3>
    {total > 0 ? <div className={styles.speech}><div className={styles.donut} style={{ background: `conic-gradient(${gradient})` }} aria-hidden="true"><span>発言の割合</span></div><dl>{rows.map(r => <div key={r.id}><dt><i style={{ background: r.color }} />{r.label}</dt><dd>{Math.round(r.percent)}% <small>{(r.ms / 1000).toFixed(1)}秒</small></dd></div>)}</dl></div> : <p className={styles.empty}>録音担当端末から発言データが届くと表示します。</p>}
    {group.speaking && <p className={styles.footnote}>直近の発言者：{group.speaking.latest?.label ?? "発話なし"}</p>}
    {group.speaking?.mode === "anonymous" && <p className={styles.footnote}>話者A・B・Cは声の区分です。名前との紐付けは行いません。</p>}
    <p className={styles.footnote}>能力・意欲を評価する数値ではありません。</p>
  </section>;
}
