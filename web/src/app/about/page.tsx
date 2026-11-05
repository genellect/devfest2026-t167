import Link from "next/link";

/** 使い方とプライバシー。どのデータを誰が見られるかを、生徒・先生の両方に示す */
export default function About() {
  return (
    <main className="screen">
      <header className="header">
        <div className="header__title"><p className="header__eyebrow">グループディスカッション支援</p><h1 className="header__name">使い方とプライバシー</h1></div>
        <div className="header__actions"><Link className="btn btn--small" href="/">トップに戻る</Link></div>
      </header>
      <div className="body" style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
        <div className="row">
          <section className="box box--md pad stack">
            <h2 className="t-md">生徒の使い方</h2>
            <ol className="stack stack--tight" style={{ margin: 0, paddingLeft: 22 }}>
              <li>先生の画面の参加コードを入力するか、QRコードを読み取ります。登録はいりません。</li>
              <li>今日の目標と、議論の前の意見を書きます。</li>
              <li>グループで話し合います。録音を始めると、画面を見なくても大丈夫です。</li>
              <li>結論を自分の言葉で一文で書きます。</li>
              <li>結果を見て振り返り、次の目標を決めます。</li>
            </ol>
          </section>
          <section className="box box--md pad stack">
            <h2 className="t-md">先生の使い方</h2>
            <ol className="stack stack--tight" style={{ margin: 0, paddingLeft: 22 }}>
              <li>Google アカウントで登録し、テーマとグループの数を決めて部屋を作ります。</li>
              <li>参加コードと QR コードを教室で映します。</li>
              <li>全員が意見を書いたら、議論を始めます。</li>
              <li>AI が見つけた「まだ話されていない論点」を確かめ、必要なものだけ全員に表示します。</li>
              <li>結論の一文がそろったら分析し、クラス全体とグループごとの結果を見ます。</li>
            </ol>
          </section>
        </div>

        <section className="box box--md pad stack">
          <h2 className="t-md">だれが何を見られるか</h2>
          <table className="table">
            <thead><tr><th>データ</th><th>本人</th><th>同じ部屋の人</th><th>先生</th><th>AI（Gemini）</th></tr></thead>
            <tbody>
              <tr><td>議論の前の意見</td><td>見られる</td><td>見られない</td><td>人数だけ</td><td>本文だけ（名前は送らない）</td></tr>
              <tr><td>結論の一文</td><td>見られる</td><td>見られない</td><td>人数と分かれ方</td><td>本文だけ（名前は送らない）</td></tr>
              <tr><td>AI の提案</td><td>先生が承認したもの</td><td>先生が承認したもの</td><td>すべて</td><td>—</td></tr>
              <tr><td>議論の録音</td><td>端末の中だけ</td><td>—</td><td>—</td><td>送信は準備中</td></tr>
              <tr><td>目標と振り返り</td><td>端末の中だけ</td><td>—</td><td>—</td><td>—</td></tr>
            </tbody>
          </table>
        </section>

        <section className="box box--md box--yellow pad stack stack--tight">
          <h2 className="t-sm">AI の結果について</h2>
          <p className="t-note">AI の分析には誤りが含まれることがあります。画面では「Gemini による推定」や「デモデータ」と表示し、実際に測った結果と区別しています。成績の判定には使いません。</p>
        </section>
      </div>
    </main>
  );
}
