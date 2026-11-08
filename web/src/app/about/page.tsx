"use client";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { useHostUser } from "@/lib/hostAuth";

const WHO = ["本人", "同じ部屋の人", "Host", "AI（Gemini）"];
/** データごとに、WHO の順で「見られる範囲」を並べる */
const ROWS = [
  ["議論の前の意見", "見られる", "見られない", "人数だけ", "本文だけ（名前は送らない）"],
  ["結論の一文", "見られる", "見られない", "人数と分かれ方", "本文だけ（名前は送らない）"],
  ["AI の提案", "Hostが承認したもの", "Hostが承認したもの", "すべて", "—"],
  ["議論の録音", "端末の中だけ", "—", "—", "ブラウザでマイクを許可して録音・送信・分析し、音声は保存しない"],
  ["振り返り", "端末の中だけ", "—", "—", "—"],
];

/** 使い方とプライバシー。どのデータを誰が見られるかを、参加者・Hostの両方に示す */
export default function About() {
  const user = useHostUser();
  return (
    <AppShell title="使い方とプライバシー" nav={!!user} actions={!user && <Link className="btn btn--small" href="/">ログインに戻る</Link>} wide>
      <div className="body" style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
        <div className="row">
          <section className="box box--md pad stack">
            <h2 className="t-md">参加者の使い方</h2>
            <ol className="stack stack--tight" style={{ margin: 0, paddingLeft: 22 }}>
              <li>Googleでログインし、ホームから参加コードを入力します。QRコードで開いた場合も、ログイン後のホームから参加します。</li>
              <li>議論の前の意見を書きます。</li>
              <li>グループで話し合います。録音を始めると、画面を見なくても大丈夫です。</li>
              <li>結論を自分の言葉で一文で書きます。</li>
              <li>結果を見て、議論への関わり方を振り返ります。</li>
            </ol>
          </section>
          <section className="box box--md pad stack">
            <h2 className="t-md">Hostの使い方</h2>
            <ol className="stack stack--tight" style={{ margin: 0, paddingLeft: 22 }}>
              <li>Google アカウントで登録し、テーマとグループの数を決めて部屋を作ります。</li>
              <li>参加コードと QR コードを教室で映します。</li>
              <li>全員が意見を書いたら、議論を始めます。</li>
              <li>AI が見つけた「まだ話されていない論点」を確かめ、必要なものだけ全員に表示します。</li>
              <li>結論の一文がそろったら分析し、セッション全体とグループごとの結果を見ます。</li>
            </ol>
          </section>
        </div>

        <section className="box box--md pad stack">
          <h2 className="t-md">だれが何を見られるか</h2>
          <table className="table table--stack">
            <thead><tr><th>データ</th>{WHO.map((w) => <th key={w}>{w}</th>)}</tr></thead>
            <tbody>
              {ROWS.map(([data, ...cells]) => (
                <tr key={data}>
                  <td className="table__head">{data}</td>
                  {cells.map((c, i) => <td key={i} data-label={WHO[i]}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="box box--md box--yellow pad stack stack--tight">
          <h2 className="t-sm">AI の結果について</h2>
          <p className="t-note">AI の分析には誤りが含まれることがあります。画面では「Gemini による推定」や「デモデータ」と表示し、実際に測った結果と区別しています。成績の判定には使いません。</p>
        </section>
      </div>
    </AppShell>
  );
}
