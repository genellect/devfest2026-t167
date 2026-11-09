import type { Metadata } from "next";
import Link from "next/link";
import { NotesScene } from "@/components/lp/LpGL";
import { LpScenes } from "@/components/lp/LpScenes";
import "./lp.css";

/*
 * Topos の紹介ページ（LP）。ログインなしで開ける（LoginGate の公開ページ）。主な読み手は教員。
 * 伝えること：AI が答えを出せる時代に、学校で育てたいのは、自分の考えを根拠とともに語り、他者の考えと比べ、
 * 自分の考えを見直す力（論理的思考とメタ認知）。Topos は、グループディスカッションをその力を育てる場にする。
 * 3機能（AGENTS.md・README）：発言率の可視化、音声認識による未検討の論点の可視化、事前の意見から結論への主張の変化の確認。
 * 行動は「ログイン」（学生・招待済みの教員）と「利用を申し込む」（これから使う教員・学校。メール）。
 */

const LEAD = "グループディスカッションで埋もれた考えを AI が見つけ、全員の考えが活かされる議論にする。";

export const metadata: Metadata = {
  title: { absolute: "Topos — 誰の考えも埋もれない議論を、すべての教室に。" },
  description: LEAD,
  openGraph: { title: "Topos — 誰の考えも埋もれない議論を、すべての教室に。", description: LEAD, locale: "ja_JP", type: "website" },
};

/** 利用の申し込み（これから使う教員・学校）。窓口はメール。件名と記入項目を入れて開く */
const CONTACT = "contact@yuto-matsui.com";
const APPLY = `mailto:${CONTACT}?subject=${encodeURIComponent("Topos の利用申し込み")}&body=${encodeURIComponent("学校名：\nお名前：\n担当の授業・学年：\n使う教員の人数：\n")}`;

/** 話し合いをさせるだけでは起きること（README「課題」） */
const GAPS = [
  { title: "最初の意見に、議論が流される", body: "異論を持っていた学生も、流れに合わせて口を閉じる。誰も検討しないまま、結論が決まる。" },
  { title: "自分の関わり方を、振り返れない", body: "どの場面で話し、どこで黙ったのか。材料がないから、次の議論も同じように過ぎていく。" },
  { title: "教員に届くのは、結論だけ", body: "どのグループで、誰の考えが失われたのか。過程が見えないまま、授業が終わる。" },
];

/** 3機能。それぞれが、学生のどの力を支えるか */
const FEATURES = [
  {
    art: "rate", name: "発言率の可視化", title: "どこで話し、どこで黙ったかが見える。",
    body: "話題ごとの発言率を示す。学生は自分の関わり方を外から振り返り、教員は声をかけるべき学生と場面を見極められる。",
    skill: "育つ力：自分の考えを見直す力",
  },
  {
    art: "points", name: "音声認識による未検討の論点の可視化", title: "誰も触れなかった論点を、議論に戻す。",
    body: "議論の録音と、学生が事前に書いた意見を照らし合わせ、話されなかった視点を見つける。教員は、それを次の問いとして投げかけられる。",
    skill: "育つ力：論理的に考える力",
  },
  {
    art: "change", name: "事前の意見から結論への主張の変化の確認", title: "考えがどう変わったかを、自分の言葉で語る。",
    body: "議論の前の意見と、議論の後の結論を並べる。なぜ変わったのか、なぜ変わらなかったのかを説明することが、そのまま学びの振り返りになる。",
    skill: "育つ力：論理的に考える力と、自分の考えを見直す力",
  },
] as const;

function FeatureArt({ kind }: { kind: "rate" | "points" | "change" }) {
  if (kind === "rate") return (
    <div className="fa fa--rate" aria-hidden="true">
      <p className="fa__cap">話題ごとの発言率</p>
      <div className="fa__topics">
        {[["意見の出し合い", 34], ["理由の深掘り", 12], ["まとめ", 28]].map(([t, v]) => (
          <div key={t} className="fa__topic"><span>{t}</span><i style={{ "--v": v } as React.CSSProperties} /><b>{v}%</b></div>
        ))}
      </div>
      <p className="fa__note">理由の深掘りの場面で、発言が減っていた</p>
    </div>
  );
  if (kind === "points") return (
    <div className="fa fa--points" aria-hidden="true">
      <p className="fa__cap">事前の意見にあった論点</p>
      <ul>
        <li className="is-done">調べものに使ってよいか<small>話された</small></li>
        <li className="is-done">レポートを書かせてよいか<small>話された</small></li>
        <li className="is-missing">使ったことを、どこまで申告するか<small>まだ話されていない</small></li>
      </ul>
    </div>
  );
  return (
    <div className="fa fa--change" aria-hidden="true">
      <div className="fa__card"><small>議論の前の意見</small>AI は禁止すべき。考える力が落ちる。</div>
      <span className="fa__arrow">↓</span>
      <div className="fa__card fa__card--after"><small>議論の後の結論</small>申告すれば、下調べには使ってよい。</div>
      <p className="fa__note">変わった理由を、自分の言葉で書く</p>
    </div>
  );
}

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
            <a href={APPLY} className="lp-nav__link">利用を申し込む</a>
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
              <p className="hero__lead">{LEAD}</p>
              <div className="lp-actions">
                <Link href="/" className="lp-btn lp-btn--light">ログイン</Link>
                <a href={APPLY} className="lp-btn lp-btn--outline">利用を申し込む</a>
              </div>
            </div>
            <p className="hero__found">学生が事前に書いていたのに、議論では誰も触れなかった論点。<br />Topos は、それを録音と照らし合わせて見つける。</p>
          </div>
        </section>

        {/* 2. なぜ今か：AI 時代に育てたい力 */}
        <section className="sec sec--white" aria-labelledby="lp-why-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-why-title" className="h2">答えは、AI が出せるようになった。</h2>
            </header>
            <div className="why" data-reveal>
              <p>だから教室で育てたいのは、答えを知っていることではない。自分の考えを根拠とともに語り、他者の考えと比べ、必要なら考えを改める力だ。</p>
              <dl className="why__skills">
                <div><dt>論理的に考える力</dt><dd>主張と根拠を結びつけ、論点を漏らさず比べる。</dd></div>
                <div><dt>自分の考えを見直す力</dt><dd>自分がどう考え、どう関わったかを、外から捉え直す。メタ認知と呼ばれる力だ。</dd></div>
              </dl>
              <p>グループディスカッションは、この2つを同時に鍛えられる場だ。</p>
            </div>
          </div>
        </section>

        {/* 3. 課題：話し合いをさせるだけでは起きること */}
        <section className="sec sec--gray" aria-labelledby="lp-gap-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-gap-title" className="h2">なのに、教室の議論では<br />考えが埋もれていく。</h2>
            </header>
            <ol className="gaps">
              {GAPS.map((g, i) => (
                <li key={g.title} className="gap" data-reveal>
                  <span className="gap__n">{i + 1}</span>
                  <h3 className="gap__title">{g.title}</h3>
                  <p className="gap__body">{g.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4. 3機能：埋もれた考えを、学びの材料に変える */}
        <section className="sec sec--white" id="features" aria-labelledby="lp-feat-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-feat-title" className="h2">Topos は、議論の過程を学びに変える。</h2>
              <p className="sec__lead">結論だけでなく、一人ひとりがどう関わり、何が話されず、考えがどう変わったかを残す。</p>
            </header>
            <div className="features">
              {FEATURES.map((f) => (
                <article key={f.art} className="feature" data-reveal>
                  <div className="feature__text">
                    <p className="feature__name">{f.name}</p>
                    <h3 className="feature__title">{f.title}</h3>
                    <p className="feature__body">{f.body}</p>
                    <p className="feature__skill">{f.skill}</p>
                  </div>
                  <FeatureArt kind={f.art} />
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 5. 教室がこう変わる */}
        <section className="sec sec--dark" aria-labelledby="lp-change-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-change-title" className="h2">考えることを、AI に任せない教室へ。</h2>
              <p className="sec__lead sec__lead--dark">AI が示すのは、考えるための手がかり。答えを出し、考えを決めるのは学生自身だ。</p>
            </header>
            <div className="outcomes" data-reveal>
              <div><h3>学生は</h3><p>発言の量ではなく、考えの中身で議論に加われる。自分の考えがなぜ変わったのかを、根拠とともに語れるようになる。</p></div>
              <div><h3>教員は</h3><p>結論ではなく、考えた過程を見て指導できる。次の授業で何を問えばよいかが見えてくる。</p></div>
            </div>
          </div>
        </section>

        {/* 6. 始め方 */}
        <section className="sec sec--gray" aria-labelledby="lp-start-title">
          <div className="wrap">
            <header className="sec__head" data-reveal>
              <h2 id="lp-start-title" className="h2">始め方</h2>
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
                <p className="start__body">テーマを入れるだけで議論を作れる。グループ分けと参加コードは自動で用意される。</p>
                <Link href="/" className="lp-btn lp-btn--dark start__cta">ログイン</Link>
              </article>
              <article className="start start--apply" data-reveal>
                <p className="start__who">これから使う教員・学校</p>
                <h3 className="start__title">利用を申し込む</h3>
                <p className="start__body">議論を作れるのは、招待を受けた教員だけ。メールで申し込むと、招待を届ける。</p>
                <a href={APPLY} className="lp-btn lp-btn--light start__cta">メールで申し込む</a>
                <p className="start__mail">{CONTACT}</p>
              </article>
            </div>
          </div>
        </section>

        {/* 7. 締め */}
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
