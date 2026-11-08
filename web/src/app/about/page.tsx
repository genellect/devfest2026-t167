"use client";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { useHostUser } from "@/lib/hostAuth";

const WHO = ["本人", "同じグループの学生", "教員", "AI（Gemini）"];
/** データごとに、WHO の順で「見られる範囲」を並べる */
const ROWS = [
  ["議論の前の意見", "見られる", "見られない", "人数だけ", "本文だけ（名前は送らない）"],
  ["結論の一文", "見られる", "見られない", "人数と分かれ方", "本文だけ（名前は送らない）"],
  ["AI の提案", "教員が全員に表示したもの", "教員が全員に表示したもの", "すべて（見送ることもできる）", "—"],
  ["発言メモ", "見られる", "見られる", "見られる", "本文だけ（名前は送らない）"],
  ["議論の録音", "端末の中だけ", "—", "—", "全員の同意後に送信・分析し、音声は保存しない"],
  ["目標と振り返り", "端末の中だけ", "—", "—", "—"],
];

/** 使い方とプライバシー。どのデータを誰が見られるかを、学生と教員の両方に示す */
export default function About() {
  const user = useHostUser();
  return (
    <AppShell title="使い方とプライバシー" nav={!!user} actions={!user && <Link className="btn btn--small" href="/">ログインに戻る</Link>} wide>
      <div className="body" style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
        <section className="about-intro">
          <h2 className="t-lg">Topos でできること</h2>
          <p>議論の前に全員の考えを非公開で集め、まだ話されていない論点と、合意の中身のずれを AI が見つけて教員に知らせます。誰の考えも埋もれない議論を、すべての教室に届けるための道具です。</p>
        </section>
        <div className="row">
          <section className="box box--md pad stack">
            <h2 className="t-md">学生の使い方</h2>
            <ol className="steps-list">
              <li><b>参加する</b><span>Google でログインし、6桁の参加コードを入れるか、「カメラで読み取る」で QR を読みます。</span></li>
              <li><b>事前の意見を書く</b><span>議論の前に、自分の考えを書きます。本文は自分だけが見られます。</span></li>
              <li><b>話し合う</b><span>出た意見を発言メモで共有します。教員からの問いかけが届いたら、それについても話します。</span></li>
              <li><b>結論を自分の言葉で書く</b><span>結論を一文で書き、どのくらい納得しているかを1〜5で選びます。</span></li>
              <li><b>結果を見る</b><span>グループの理解がどう分かれたかを見て、振り返ります。</span></li>
            </ol>
          </section>
          <section className="box box--md pad stack">
            <h2 className="t-md">教員の使い方</h2>
            <ol className="steps-list">
              <li><b>議論を作る</b><span>テーマを決めて作ります。教員として招待されたアカウントだけが作れます。</span></li>
              <li><b>投影画面を映す</b><span>参加コードと QR を教室に映し、全員の事前の意見がそろったら議論を始めます。</span></li>
              <li><b>論点を投げかける</b><span>AI が提案した「まだ話されていない論点」を確かめ、全員に表示するか、見送ります。</span></li>
              <li><b>結果をまとめる</b><span>議論を終え、全員の結論の一文がそろったら、合意の中身と指標を見ます。</span></li>
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

        <section className="box box--md box--tint pad stack stack--tight">
          <h2 className="t-sm">AI の結果について</h2>
          <p className="t-note">AI の分析には誤りが含まれることがあります。画面では「AI による推定」や「デモデータ」と表示し、実際に測った結果と区別しています。成績の判定には使いません。</p>
        </section>
      </div>
    </AppShell>
  );
}
