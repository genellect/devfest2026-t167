/**
 * 合意の実態検証：同じ結論に賛成していても、理解がいくつに分かれたかを、色の違う付箋で並べる。
 * 色はまとまりの区別だけを表す（よい・悪いの意味はない）。黄色は「まだ話されていない論点」専用なので使わない。
 * まとまりの言葉は Gemini が言い換えたもので、学生が書いた一文そのものではない。
 */
const TONES = ["blue", "pink", "mint", "lilac"] as const;
export const toneOf = (i: number) => TONES[i % TONES.length];

export type Cluster = { label: string; count: number };
const sorted = (clusters: Cluster[]) => [...clusters].sort((a, b) => b.count - a.count);

/** 見出しの一文。結果の画面の最初に置く */
export const describeUnderstanding = (clusters: Cluster[] | undefined) =>
  !clusters || clusters.length === 0 ? "まだ回答がありません"
    : clusters.length === 1 ? "結論の理解は、ほぼそろっていました"
      : `同じ結論でも、理解が${clusters.length}通りに分かれました`;

/** まとまりごとの付箋。人数は丸の数でも示す（12人を超えたら数字だけ） */
export function UnderstandingNotes({ clusters }: { clusters: Cluster[] }) {
  const list = sorted(clusters);
  if (!list.length) return null;
  return (
    <ul className="understand" aria-label="理解のまとまり">
      {list.map((c, i) => (
        <li key={i} className={`understand__note understand__note--${toneOf(i)}`}>
          <p className="understand__label">{c.label}</p>
          <p className="understand__count">
            {c.count <= 12 && <span className="understand__dots" aria-hidden="true">{Array.from({ length: c.count }, (_, k) => <span key={k} />)}</span>}
            <span>{c.count}人</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** グループを比べる表に置く細い帯。まとまりの人数の割合を、付箋と同じ色で並べる */
export function SplitBar({ clusters }: { clusters: Cluster[] }) {
  const list = sorted(clusters);
  const total = list.reduce((n, c) => n + c.count, 0);
  if (!total) return null;
  return (
    <span className="split-bar" role="img" aria-label={list.map((c) => `${c.label} ${c.count}人`).join("、")}>
      {list.map((c, i) => <span key={i} className={`split-bar__part understand__note--${toneOf(i)}`} style={{ flexGrow: c.count }} />)}
    </span>
  );
}
