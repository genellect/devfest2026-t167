import Link from "next/link";

/** トップページ。サービスの紹介と、生徒・先生それぞれの入口 */
export default function Top() {
  return (
    <main className="screen">
      <header className="header">
        <div className="header__title"><p className="header__name">グループディスカッション支援</p></div>
        <div className="header__actions">
          <Link className="btn btn--small" href="/about">使い方とプライバシー</Link>
        </div>
      </header>
      <div className="body" style={{ gap: 28 }}>
        <section className="box box--lg box--blue" style={{ padding: "48px 48px 44px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 32, alignItems: "end" }}>
          <div className="stack" style={{ gap: 18 }}>
            <h1 className="t-hero" style={{ fontSize: 52, lineHeight: 1.35 }}>「全員賛成」の中身のずれを、<br />議論が終わる前に見つける。</h1>
            <p style={{ fontSize: 19 }}>議論の前に全員の意見を非公開で集め、まだ話されていない論点と、合意の中身のずれを AI が見つけます。</p>
          </div>
        </section>

        <div className="row">
          <section className="box box--lg pad-lg stack" style={{ gap: 16 }}>
            <p className="t-label">生徒の方</p>
            <h2 className="t-lg">議論に参加する</h2>
            <p className="t-note">先生の画面に出ている6文字のコードを入力するか、QRコードを読み取ります。登録はいりません。</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: "auto" }}>
              <Link className="btn btn--blue" href="/join">参加コードを入力</Link>
              <Link className="btn" href="/student">これまでの振り返り</Link>
            </div>
          </section>
          <section className="box box--lg box--yellow pad-lg stack" style={{ gap: 16 }}>
            <p className="t-label">先生の方</p>
            <h2 className="t-lg">授業の議論を準備する</h2>
            <p className="t-note">Google アカウントで登録すると、テーマとグループの数を決めて、すぐに部屋を作れます。</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: "auto" }}>
              <Link className="btn btn--ink" href="/host">ログイン</Link>
              <Link className="btn" href="/host/signup">新規登録</Link>
            </div>
          </section>
        </div>

        <section className="stack">
          <h2 className="t-md">議論の流れ</h2>
          <ol className="row" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {[
              ["事前の意見", "議論の前に、全員が自分の意見を書きます。本文は本人にしか見えません。"],
              ["議論", "グループで話し合います。まだ話されていない論点を AI が見つけ、先生が承認したものだけが全員に届きます。"],
              ["合意の確認", "結論を一人ひとりが自分の言葉で書きます。同じ結論の理解が分かれていないかを AI がまとめます。"],
              ["振り返り", "議論の流れ、よかった場面と見直したい場面を見て、次の目標を決めます。"],
            ].map(([title, body], i) => (
              <li key={title} className="box box--md pad stack stack--tight">
                <p className="t-small" style={{ fontWeight: 700 }}>ステップ{i + 1}</p>
                <h3 className="t-sm">{title}</h3>
                <p className="t-note">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
