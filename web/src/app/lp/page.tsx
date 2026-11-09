import type { Metadata } from "next";
import Link from "next/link";
import { InstallButton } from "@/components/lp/InstallButton";
import { LpDemo } from "@/components/lp/LpDemo";
import { LpScenes } from "@/components/lp/LpScenes";
import "./lp.css";

/*
 * Topos の紹介ページ（LP）。ログインなしで開ける（LoginGate の公開ページ）。
 * 中身は確定要件（README・Docs）のとおり：事前意見収集・未検討論点の検出・合意の実態検証、AI の提案は教員が承認する。
 * 行動は「デモを体験」と「インストール」。教員ひとりでも、学校全体でも導入できることを示す。
 * 見せ方は、画面全体を使った場面とスクロールの演出で、価値を一目で伝える。アプリの画面は使わない。
 */

export const metadata: Metadata = {
  title: { absolute: "Topos — 誰の考えも埋もれない議論を、すべての教室に。" },
  description: "議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つけます。",
  openGraph: { title: "Topos — 誰の考えも埋もれない議論を、すべての教室に。", description: "議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つけます。", locale: "ja_JP", type: "website" },
};

/** 冒頭の場面：教室の全員が議論の前に書いた意見。決まった式で散らす（毎回同じ配置） */
const OPINIONS = [
  "調べものには便利", "ズルにならない？", "使ったら書くべき", "社会に出たら使う", "考える力が落ちそう", "下書きまでならいい",
  "まず確かめたい", "翻訳はいいと思う", "全部禁止は無理", "出典が怪しい", "アイデア出しだけ", "自分の言葉で書きたい",
  "評価はどうなる？", "使い方を教えてほしい", "要約に使いたい", "提出前に確認する", "検索と同じでは", "誤りに気づけるか",
  "授業で練習したい", "ルールがほしい", "使わない人が損する", "楽をしたいわけじゃない", "コードの説明に", "読書感想文は？",
  "メモの整理に", "公平じゃない気がする", "AIの答えは正しい？", "どこまでがOK？", "共同で使うのは？", "発表資料には便利",
  "先輩はどうしてた？", "まず試してみたい",
];
const FIELD = OPINIONS.map((text, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12543.1234;
  const x = 4 + (a - Math.floor(a)) * 88, y = 6 + (b - Math.floor(b)) * 84, depth = 0.55 + ((a * b) % 1 + 1) % 1 * 0.5;
  return { text, x: +x.toFixed(1), y: +y.toFixed(1), depth: +depth.toFixed(2) };
});

const SPLIT = [
  { text: "申告すれば、\nレポートにも使える", n: 3, color: "blue" },
  { text: "アイデア出しに\nだけ使える", n: 2, color: "pink" },
  { text: "教員が許可した\nときだけ", n: 1, color: "mint" },
];

export default function LandingPage() {
  return (
    <div className="lp">
      {/* eslint-disable-next-line @next/next/no-page-custom-font -- 見出しの極太（800・900）は LP だけで使う */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@800;900&display=swap" precedence="default" />
      <LpScenes />

      <header className="lp-nav">
        <div className="lp-nav__in">
          <Link href="/lp" className="lp-nav__brand"><span className="lp-nav__mark" aria-hidden="true" />Topos</Link>
          <nav className="lp-nav__end" aria-label="LP">
            <Link href="/" className="lp-nav__link">ログイン</Link>
            <a href="#demo" className="lp-btn lp-btn--sm">デモを体験</a>
          </nav>
        </div>
      </header>

      <main>
        {/* 1. 埋もれた意見の中から、まだ話されていない論点が浮かび上がる */}
        <section className="sc sc--hero" data-scene aria-labelledby="lp-title">
          <div className="sc__stick">
            <div className="field" aria-hidden="true">
              {FIELD.map((f) => (
                <span key={f.text} className="field__note" style={{ "--x": f.x, "--y": f.y, "--d": f.depth } as React.CSSProperties}>{f.text}</span>
              ))}
              <span className="field__note field__note--found" style={{ "--x": 64, "--y": 70, "--d": 0.8 } as React.CSSProperties}>
                <small>まだ話されていない論点</small>AI を使ったことを、<br />どこまで申告する？
              </span>
            </div>
            <div className="hero">
              <p className="hero__brand">Topos</p>
              <h1 id="lp-title" className="hero__title"><span>誰の考えも</span><span>埋もれない議論を、</span><span>すべての教室に。</span></h1>
              <div className="lp-actions">
                <a href="#demo" className="lp-btn lp-btn--light">デモを体験</a>
                <InstallButton className="lp-btn lp-btn--outline" />
              </div>
            </div>
            <p className="hero__found">議論の前に、全員が書いていた。<br />でも、まだ誰も話していない。<b>Topos は、それを見つけて教員に知らせます。</b></p>
          </div>
        </section>

        {/* 2. 全員が賛成しても、理解は分かれている */}
        <section className="sc sc--split" data-scene aria-labelledby="lp-split-title">
          <div className="sc__stick">
            <p className="split__word" aria-hidden="true">全員、賛成。</p>
            <ul className="split__notes" aria-label="結論「AI の利用を認める」の理解の分かれ方">
              {SPLIT.map((s, i) => (
                <li key={s.color} className={`split__note split__note--${i + 1} paper--${s.color}`}>
                  <span>{s.text.split("\n").map((l, j) => <span key={j}>{l}<br /></span>)}</span>
                  <small>{s.n}人</small>
                </li>
              ))}
            </ul>
            <div className="split__after">
              <h2 id="lp-split-title" className="split__title">同じ結論に、<br className="sp" />3通りの理解。</h2>
              <p>結論「AI の利用を認める」を、全員が自分の言葉で一文に。<br />Topos は、理解がいくつに分かれたかを示します。</p>
            </div>
          </div>
        </section>

        {/* 3. 3つの機能 */}
        <section className="sec sec--light" id="features" aria-labelledby="lp-feat-title">
          <div className="wrap">
            <h2 id="lp-feat-title" className="big" data-reveal>議論の前に。<br />議論の中で。<br />議論のあとに。</h2>
            <div className="tiles">
              <article className="tile" data-reveal>
                <p className="tile__when">議論の前に</p>
                <h3 className="tile__title">全員が、<br />先に書く。</h3>
                <p className="tile__body">意見は非公開で集めます。本文を読めるのは本人だけ。教員にも、ほかの学生にも見えません。</p>
                <div className="tile__art art-private" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>
                <p className="tile__name">事前意見収集</p>
              </article>
              <article className="tile tile--dark" data-reveal>
                <p className="tile__when">議論の中で</p>
                <h3 className="tile__title">話されていない<br />論点を、教員へ。</h3>
                <p className="tile__body">事前の意見と議論を Gemini が照らし合わせ、まだ誰も話していない論点を見つけます。</p>
                <div className="tile__art art-found" aria-hidden="true"><i /><i /><i className="is-found" /><i /><i /></div>
                <p className="tile__name">未検討論点の検出</p>
              </article>
              <article className="tile" data-reveal>
                <p className="tile__when">議論のあとに</p>
                <h3 className="tile__title">合意の中身を、<br />確かめる。</h3>
                <p className="tile__body">全員が結論を一文で書き、Gemini が同じ理解ごとにまとめます。</p>
                <div className="tile__art art-split" aria-hidden="true"><i /><i /><i /></div>
                <p className="tile__name">合意の実態検証</p>
              </article>
            </div>
          </div>
        </section>

        {/* 4. 主導権は人に */}
        <section className="sec sec--dark" aria-labelledby="lp-lead-title">
          <div className="wrap wrap--center">
            <h2 id="lp-lead-title" className="giant" data-reveal>決めるのは、<br />教員。</h2>
            <div className="approve" data-reveal aria-hidden="true">
              <p className="approve__label">まだ話されていない論点</p>
              <p className="approve__text">AI を使ったことを、どこまで申告する？</p>
              <p className="approve__btns"><span className="approve__ok">全員に表示する</span><span className="approve__skip">見送る</span></p>
            </div>
            <p className="lead lead--dark" data-reveal>AI の提案は、教員が承認してから学生に届きます。<br />議論の主導権は、人に残ります。</p>
          </div>
        </section>

        {/* 5. デモ */}
        <section className="sec sec--demo" id="demo" aria-labelledby="lp-demo-title">
          <div className="wrap">
            <h2 id="lp-demo-title" className="big">体験すると、<br className="sp" />わかる。</h2>
            <p className="lead">学生として意見を書き、教員の画面で何が起きるかを確かめてください。ログインは要りません。</p>
            <LpDemo />
          </div>
        </section>

        {/* 6. プライバシー */}
        <section className="sec sec--dark" aria-labelledby="lp-privacy-title">
          <div className="wrap">
            <h2 id="lp-privacy-title" className="big" data-reveal>書いた意見は、<br />本人だけが読める。</h2>
            <ul className="facts" data-reveal>
              <li><b>事前の意見と結論の一文</b>本文を読めるのは本人だけ。教員にも、ほかの学生にも見えません。</li>
              <li><b>AI が見つけた論点</b>持ち主を伏せて言い換え、教員が承認したものだけを全員に表示します。</li>
              <li><b>Gemini に送るもの</b>判定に要る本文と、全員が同意した録音だけ。名前と ID は送りません。</li>
            </ul>
            <Link href="/about" className="more more--dark">だれが何を読めるか ›</Link>
          </div>
        </section>

        {/* 7. 導入 */}
        <section className="sec sec--light" aria-labelledby="lp-adopt-title">
          <div className="wrap">
            <h2 id="lp-adopt-title" className="big" data-reveal>教員ひとりから、<br />学校全体まで。</h2>
            <div className="plans">
              <article className="plan" data-reveal>
                <p className="plan__who">教員</p>
                <h3>次の授業から、<br />すぐに使える。</h3>
                <p>招待を受けた Google アカウントで、議論を作れます。学生は参加コードか QR で参加します。</p>
              </article>
              <article className="plan plan--school" data-reveal>
                <p className="plan__who">学校</p>
                <h3>すべての教室に、<br />まとめて。</h3>
                <p>教員の権限を学校で管理し、全クラスで使えます。学生は Google アカウントがあれば参加できます。</p>
              </article>
            </div>
          </div>
        </section>

        {/* 8. 名前 */}
        <section className="sec sec--name" aria-labelledby="lp-name-title">
          <div className="wrap wrap--center">
            <p className="name__greek" aria-hidden="true" data-reveal>τόπος</p>
            <h2 id="lp-name-title" className="name__title" data-reveal>論点の在りか。</h2>
            <p className="lead" data-reveal>アリストテレスは、議論の論点を引き出す型を「トポイ」と呼びました。<br />Topos は、議論の中にまだ現れていない論点を、AI で見つけます。</p>
          </div>
        </section>

        {/* 9. 締め */}
        <section className="sec sec--end" aria-labelledby="lp-end-title">
          <div className="wrap wrap--center">
            <h2 id="lp-end-title" className="giant">次の議論から、<br />誰の考えも<br className="sp" />埋もれない。</h2>
            <div className="lp-actions">
              <a href="#demo" className="lp-btn lp-btn--light">デモを体験</a>
              <InstallButton className="lp-btn lp-btn--outline" />
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <p className="foot__brand">Topos</p>
        <p>誰の考えも埋もれない議論を、すべての教室に。</p>
        <nav aria-label="フッター" className="foot__links"><Link href="/about">プライバシー</Link><Link href="/">ログイン</Link></nav>
      </footer>
    </div>
  );
}
