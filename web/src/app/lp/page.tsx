import type { Metadata } from "next";
import Link from "next/link";
import { InstallButton } from "@/components/lp/InstallButton";
import { LpDemo } from "@/components/lp/LpDemo";
import { LpScenes } from "@/components/lp/LpScenes";
import "./lp.css";

/*
 * Topos の紹介ページ（LP）。ログインなしで開ける（LoginGate の公開ページ）。
 * 見出しは確定済みのタグライン。構成はタグラインの前半と後半を順に掘り下げる。
 * - 誰の考えも埋もれない議論：議論の前・中・あとの3つの機能（事前意見収集・未検討論点の検出・合意の実態検証）
 * - すべての教室に：学生・教員・学校それぞれにとっての価値（Docs「サービス形態」の目的）
 * 行動は「デモを体験」と「インストール」。アプリの画面は使わず、付箋と教室の図で見せる。
 */

export const metadata: Metadata = {
  title: { absolute: "Topos — 誰の考えも埋もれない議論を、すべての教室に。" },
  description: "議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つけます。",
  openGraph: { title: "Topos — 誰の考えも埋もれない議論を、すべての教室に。", description: "議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つけます。", locale: "ja_JP", type: "website" },
};

/** 決まった式の疑似乱数（描画のたびに同じ配置にする） */
const rand = (i: number, k: number) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

/** 冒頭の場面：議論の前に学生が書いた考え */
const THOUGHTS = [
  "調べものには便利", "ズルにならない？", "使ったら書くべき", "社会に出たら使う", "考える力が落ちそう", "下書きまでならいい",
  "まず確かめたい", "翻訳はいいと思う", "全部禁止は無理", "出典が怪しい", "アイデア出しだけ", "自分の言葉で書きたい",
  "評価はどうなる？", "使い方を学びたい", "要約に使いたい", "提出前に確認する", "検索と同じでは", "誤りに気づけるか",
  "授業で練習したい", "ルールがほしい", "使わない人が損する", "楽をしたいわけじゃない", "コードの説明に", "読書感想文は？",
  "メモの整理に", "公平じゃない気がする", "答えは正しい？", "どこまでがOK？", "共同で使うのは？", "発表資料には便利",
  "先輩はどうしてた？", "まず試してみたい",
].map((text, i) => ({ text, x: +(4 + rand(i, 1) * 92).toFixed(1), y: +(6 + rand(i, 2) * 88).toFixed(1), d: +(0.55 + rand(i, 3) * 0.5).toFixed(2) }));

/** 「すべての教室に」の場面：教室（6つのグループ）を並べる。真ん中の教室から引いていく */
const COLS = 9, ROWS = 9, CENTER = { c: 4, r: 4 };
const NOTE = ["b", "p", "m", "l", "w"];
const ROOMS = Array.from({ length: COLS * ROWS }, (_, i) => {
  const c = i % COLS, r = Math.floor(i / COLS);
  const dist = Math.hypot(c - CENTER.c, (r - CENTER.r) * 1.4);
  const groups = Array.from({ length: 6 }, (_, g) => Array.from({ length: 3 + Math.floor(rand(i * 6 + g, 4) * 3) }, (_, n) =>
    rand(i * 31 + g * 7 + n, 5) > 0.93 ? "y" : NOTE[Math.floor(rand(i * 17 + g * 5 + n, 6) * NOTE.length)]));
  return { i, c, r, dist: +dist.toFixed(2), groups, center: c === CENTER.c && r === CENTER.r };
});

const STAGES = [
  { when: "議論の前に", title: ["全員が、", "先に考える。"], body: "意見は非公開で集めます。本文を読めるのは本人だけ。人前で言いにくい考えも、先に書いておけます。", feature: "事前意見収集", art: "before" },
  { when: "議論の中で", title: ["話されていない考えを、", "見つける。"], body: "事前の意見と議論を Gemini が照らし合わせ、まだ話されていない論点を教員に届けます。問いかけるかどうかは、教員が決めます。", feature: "未検討論点の検出", art: "during" },
  { when: "議論のあとに", title: ["一人ひとりの理解を、", "確かめる。"], body: "全員が結論を一文で書き、Gemini が同じ理解ごとにまとめます。理解が分かれたところを、次の授業で扱えます。", feature: "合意の実態検証", art: "after" },
] as const;

function StageArt({ kind }: { kind: "before" | "during" | "after" }) {
  if (kind === "before") return (
    <div className="art art--before" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--k": i } as React.CSSProperties} />)}
      <span className="art__lock">本人だけが読める</span>
    </div>
  );
  if (kind === "during") return (
    <div className="art art--during" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => <i key={i} />)}
      <div className="art__found">
        <small>まだ話されていない論点</small>
        <b>AI を使ったことを、どこまで申告する？</b>
        <span><em>全員に表示する</em>見送る</span>
      </div>
    </div>
  );
  return (
    <div className="art art--after" aria-hidden="true">
      <p className="art__said">結論：AI の利用を認める</p>
      <div className="art__groups">
        <span className="u-b">申告すれば、レポートにも<small>3人</small></span>
        <span className="u-p">アイデア出しにだけ<small>2人</small></span>
        <span className="u-m">教員が許可したときだけ<small>1人</small></span>
      </div>
    </div>
  );
}

const AUDIENCE = [
  { who: "学生に", title: ["話すのが苦手でも、", "考えは届く。"], body: "発言の多さではなく、考えで議論に加われます。議論を重ねるほど、対話と協働の力が育ちます。", art: "student" },
  { who: "教員に", title: ["すべてのグループが、", "見渡せる。"], body: "教室を回らなくても、どのグループで何が話されていないかがわかります。準備はテーマを入れるだけです。", art: "teacher" },
  { who: "学校に", title: ["どの教室でも、", "安心して。"], body: "意見の本文は本人だけが読めます。AI は成績をつけません。議論を作れる教員の権限は、学校で管理します。", art: "school" },
] as const;

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
            <a href="#how" className="lp-nav__link">しくみ</a>
            <a href="#everyone" className="lp-nav__link">すべての教室に</a>
            <Link href="/" className="lp-nav__link">ログイン</Link>
            <a href="#demo" className="lp-btn lp-btn--sm">デモを体験</a>
          </nav>
        </div>
      </header>

      <main>
        {/* 1. 誰の考えも埋もれない：埋もれた考えの中から、まだ話されていない論点が浮かび上がる */}
        <section className="sc sc--hero" data-scene aria-labelledby="lp-title">
          <div className="sc__stick">
            <div className="field" aria-hidden="true">
              {THOUGHTS.map((f) => (
                <span key={f.text} className="field__note" style={{ "--x": f.x, "--y": f.y, "--d": f.d } as React.CSSProperties}>{f.text}</span>
              ))}
              <span className="field__note field__note--found" style={{ "--x": 64, "--y": 72, "--d": 0.8 } as React.CSSProperties}>
                <small>まだ話されていない論点</small>AI を使ったことを、<br />どこまで申告する？
              </span>
            </div>
            <div className="hero">
              <p className="hero__brand">Topos</p>
              <h1 id="lp-title" className="hero__title"><span>誰の考えも</span><span>埋もれない議論を、</span><span>すべての教室に。</span></h1>
              <p className="hero__lead">議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つけます。</p>
              <div className="lp-actions">
                <a href="#demo" className="lp-btn lp-btn--light">デモを体験</a>
                <InstallButton className="lp-btn lp-btn--outline" />
              </div>
            </div>
            <p className="hero__found">書かれていたのに、まだ話されていない考え。<b>Topos は、それを見つけて教員に届けます。</b></p>
          </div>
        </section>

        {/* 2. 誰の考えも埋もれない議論：議論の前・中・あと */}
        <section className="sec sec--white" id="how" aria-labelledby="lp-how-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-how-title" className="h2">議論の前から、<br />あとまで。</h2>
              <p className="sec__lead">Topos は3つの場面で、一人ひとりの考えを拾いあげます。</p>
            </header>
            <div className="stages">
              {STAGES.map((s) => (
                <article key={s.art} className={`stage stage--${s.art}`} data-reveal>
                  <div className="stage__text">
                    <p className="stage__when">{s.when}</p>
                    <h3 className="stage__title">{s.title[0]}<br />{s.title[1]}</h3>
                    <p className="stage__body">{s.body}</p>
                    <p className="stage__feature">{s.feature}</p>
                  </div>
                  <StageArt kind={s.art} />
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 3. すべての教室に：ひとつの教室から引いていくと、たくさんの教室が灯る */}
        <section className="sc sc--rooms" id="everyone" data-scene aria-labelledby="lp-rooms-title">
          <div className="sc__stick">
            <div className="rooms" aria-hidden="true" style={{ "--cols": COLS, "--rows": ROWS } as React.CSSProperties}>
              {ROOMS.map((room) => (
                <div key={room.i} className={`room${room.center ? " room--center" : ""}`} style={{ "--dist": room.dist } as React.CSSProperties}>
                  {room.groups.map((g, gi) => <span key={gi} className="room__group">{g.map((n, ni) => <i key={ni} className={`n-${n}`} />)}</span>)}
                </div>
              ))}
            </div>
            <p className="rooms__one" aria-hidden="true">ひとつの教室から、</p>
            <div className="rooms__all">
              <h2 id="lp-rooms-title" className="h2">すべての教室に。</h2>
              <p className="sec__lead">学生にも、教員にも、学校にも。</p>
            </div>
          </div>
        </section>

        <section className="sec sec--gray" aria-label="学生・教員・学校にとっての価値">
          <div className="wrap">
            <div className="audience">
              {AUDIENCE.map((a) => (
                <article key={a.art} className={`aud aud--${a.art}`} data-reveal>
                  <div className={`aud__art aud__art--${a.art}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
                  <p className="aud__who">{a.who}</p>
                  <h3 className="aud__title">{a.title[0]}<br />{a.title[1]}</h3>
                  <p className="aud__body">{a.body}</p>
                </article>
              ))}
            </div>
            <Link href="/about" className="more">だれが何を読めるか ›</Link>
          </div>
        </section>

        {/* 4. デモ */}
        <section className="sec sec--white" id="demo" aria-labelledby="lp-demo-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-demo-title" className="h2">ひとつの議論を、<br />体験する。</h2>
              <p className="sec__lead">学生として書き、教員の画面で何が起きるかを確かめてください。ログインは要りません。</p>
            </header>
            <LpDemo />
          </div>
        </section>

        {/* 5. 始め方 */}
        <section className="sec sec--gray" aria-labelledby="lp-start-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-start-title" className="h2">教員ひとりから、<br />学校全体まで。</h2>
            </header>
            <div className="plans">
              <article className="plan" data-reveal>
                <p className="plan__who">教員</p>
                <h3 className="plan__title">次の授業から。</h3>
                <p className="plan__body">招待を受けた Google アカウントで、すぐに議論を作れます。学生は参加コードか QR で加わります。</p>
              </article>
              <article className="plan plan--school" data-reveal>
                <p className="plan__who">学校</p>
                <h3 className="plan__title">すべての教室で。</h3>
                <p className="plan__body">議論を作れる教員の権限を、学校でまとめて管理します。学生は Google アカウントがあれば参加できます。</p>
              </article>
            </div>
          </div>
        </section>

        {/* 6. 締め */}
        <section className="sec sec--end" aria-labelledby="lp-end-title">
          <div className="wrap wrap--center">
            <p className="end__brand"><span aria-hidden="true" />Topos</p>
            <h2 id="lp-end-title" className="end__title">誰の考えも埋もれない議論を、<br />すべての教室に。</h2>
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
