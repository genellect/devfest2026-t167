import type { Metadata } from "next";
import Link from "next/link";
import { LpDemo } from "@/components/lp/LpDemo";
import { NotesScene, RoomsScene } from "@/components/lp/LpGL";
import { LpScenes } from "@/components/lp/LpScenes";
import "./lp.css";

/*
 * Topos の紹介ページ（LP）。ログインなしで開ける（LoginGate の公開ページ）。
 * 見出しは確定済みのタグライン。構成はタグラインの前半と後半を順に掘り下げる。
 * - 誰の考えも埋もれない議論：議論の前・中・あとの3つの機能（事前意見収集・未検討論点の検出・合意の実態検証）
 * - すべての教室に：学生・教員・学校それぞれにとっての価値（Docs「サービス形態」の目的）
 * 行動は「ログイン」（学生・招待済みの教員）と「利用を申し込む」（これから使う教員・学校。メール）。「デモを体験」は LP の中で完結する。主役は映像（Three.js の2つの場面と付箋の図）で、文章は短く控えめにする。アプリの画面は使わない。
 */

export const metadata: Metadata = {
  title: { absolute: "Topos — 誰の考えも埋もれない議論を、すべての教室に。" },
  description: "議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つける。",
  openGraph: { title: "Topos — 誰の考えも埋もれない議論を、すべての教室に。", description: "議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つける。", locale: "ja_JP", type: "website" },
};

/** 利用の申し込み（これから使う教員・学校）。窓口はメール。件名と記入項目を入れて開く */
const CONTACT = "contact@yuto-matsui.com";
const APPLY = `mailto:${CONTACT}?subject=${encodeURIComponent("Topos の利用申し込み")}&body=${encodeURIComponent("学校名：\nお名前：\n担当の授業・学年：\n使う教員の人数：\n")}`;

const STAGES = [
  { when: "議論の前", title: "まず、全員が書く。", body: "読めるのは、書いた本人だけ。人前では言えない本音も、ここなら書ける。", feature: "事前意見収集", art: "before" },
  { when: "議論の最中", title: "話されていない論点を、AI がそっと教員に知らせる。", body: "全員に問いかけるかどうかは、教員が決める。", feature: "未検討論点の検出", art: "during" },
  { when: "議論の後", title: "「わかったつもり」が、見えるようになる。", body: "全員が結論を一文で書くと、理解の分かれ目が浮かび上がる。次の授業は、そこから始められる。", feature: "合意の実態検証", art: "after" },
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
  { who: "学生", title: "話すのが苦手でも、考えはちゃんと届く。", body: "発言の多さではなく、考えの中身で議論に加われる。重ねるほど、対話の力が育っていく。", art: "student" },
  { who: "教員", title: "全部のグループの声が、手元に集まる。", body: "教室を回りきれなくても、どこで何が話されていないかがわかる。準備はテーマを入れるだけ。", art: "teacher" },
  { who: "学校", title: "安心して、すべての教室に。", body: "意見の本文は、書いた本人にしか見えない。AI が成績をつけることもない。", art: "school" },
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
            <a href="#demo" className="lp-nav__link">デモを体験</a>
            <Link href="/" className="lp-btn lp-btn--sm">ログイン</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* 1. 冒頭：付箋の空間（WebGL）。スクロールで、まだ話されていない論点が手前に来る */}
        <section className="sc sc--hero" data-scene aria-labelledby="lp-title">
          <div className="sc__stick">
            <NotesScene label="まだ話されていない論点" lines={["AI を使ったことを、", "どこまで申告する？"]} />
            <div className="hero">
              <p className="hero__brand">Topos</p>
              <h1 id="lp-title" className="hero__title">誰の考えも埋もれない議論を、<br />すべての教室に。</h1>
              <p className="hero__lead">議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つける。</p>
              <div className="lp-actions">
                <Link href="/" className="lp-btn lp-btn--light">ログイン</Link>
                <a href="#demo" className="lp-btn lp-btn--outline">デモを体験</a>
              </div>
            </div>
            <p className="hero__found">書いたのに、言い出せなかった意見がある。<br />Topos は、それを見逃さない。</p>
          </div>
        </section>

        {/* 2. 誰の考えも埋もれない議論：議論の前・中・あと */}
        <section className="sec sec--white" id="how" aria-labelledby="lp-how-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-how-title" className="h2">声の小さな意見ほど、議論を変える。</h2>
            </header>
            <div className="stages">
              {STAGES.map((s) => (
                <article key={s.art} className={`stage stage--${s.art}`} data-reveal>
                  <div className="stage__text">
                    <p className="stage__when">{s.when}</p>
                    <h3 className="stage__title">{s.title}</h3>
                    <p className="stage__body">{s.body}</p>
                    <p className="stage__feature">{s.feature}</p>
                  </div>
                  <StageArt kind={s.art} />
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 3. すべての教室に：教室が並ぶ空間（WebGL）。引いていくと、中央から外へ灯っていく */}
        <section className="sc sc--rooms" id="everyone" data-scene aria-labelledby="lp-rooms-title">
          <div className="sc__stick">
            <RoomsScene />
            <h2 id="lp-rooms-title" className="rooms__cap">ひとつの教室から始めて、学校じゅうに広げられる。</h2>
          </div>
        </section>

        <section className="sec sec--gray" aria-labelledby="lp-aud-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-aud-title" className="h2">教室が、こう変わる。</h2>
            </header>
            <div className="audience">
              {AUDIENCE.map((a) => (
                <article key={a.art} className={`aud aud--${a.art}`} data-reveal>
                  <div className={`aud__art aud__art--${a.art}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
                  <p className="aud__who">{a.who}</p>
                  <h3 className="aud__title">{a.title}</h3>
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
              <h2 id="lp-demo-title" className="h2">ひとつの議論を、3分で体験する。</h2>
              <p className="sec__lead">学生として意見を書いて、教員の画面で何が起きるかを見てみよう。ログインはいらない。</p>
            </header>
            <LpDemo />
          </div>
        </section>

        {/* 5. 始め方 */}
        <section className="sec sec--gray" aria-labelledby="lp-start-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-start-title" className="h2">今日から、使い始める。</h2>
            </header>
            <div className="starts">
              <article className="start" data-reveal>
                <p className="start__who">学生</p>
                <h3 className="start__title">授業の議論に参加する</h3>
                <p className="start__body">教員から届いた参加コードか QR で入る。Google アカウントがあれば参加できる。</p>
                <Link href="/" className="lp-btn lp-btn--dark start__cta">ログインして参加する</Link>
              </article>
              <article className="start" data-reveal>
                <p className="start__who">招待を受けた教員</p>
                <h3 className="start__title">議論を作る</h3>
                <p className="start__body">招待された Google アカウントでログインすると、すぐにテーマを入れて議論を作れる。</p>
                <Link href="/" className="lp-btn lp-btn--dark start__cta">ログイン</Link>
              </article>
              <article className="start start--apply" data-reveal>
                <p className="start__who">これから使う教員・学校</p>
                <h3 className="start__title">利用を申し込む</h3>
                <p className="start__body">教員1人でも、学校全体でも。メールで申し込むと、議論を作れる教員の招待を届ける。</p>
                <a href={APPLY} className="lp-btn lp-btn--light start__cta">メールで申し込む</a>
                <p className="start__mail">{CONTACT}</p>
              </article>
            </div>
          </div>
        </section>

        {/* 6. 締め */}
        <section className="sec sec--end" aria-labelledby="lp-end-title">
          <div className="wrap wrap--center">
            <p className="end__brand"><span aria-hidden="true" />Topos</p>
            <h2 id="lp-end-title" className="end__title">誰の考えも埋もれない議論を、すべての教室に。</h2>
            <div className="lp-actions">
              <Link href="/" className="lp-btn lp-btn--light">ログイン</Link>
              <a href={APPLY} className="lp-btn lp-btn--outline">利用を申し込む</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <p className="foot__brand">Topos</p>
        <p>© 2026 Triple Helix. Developed by Yuto, Ryota &amp; Koyuri.</p>
        <nav aria-label="フッター" className="foot__links"><Link href="/about">プライバシー</Link><a href={APPLY}>お問い合わせ</a><Link href="/">ログイン</Link></nav>
      </footer>
    </div>
  );
}
