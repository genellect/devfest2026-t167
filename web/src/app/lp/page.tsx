import type { Metadata } from "next";
import { ToposLp } from "@/components/lp/ToposLp";
import "./lp.css";

/*
 * Topos の紹介ページ（LP）。ログインなしで開ける（LoginGate の公開ページ）。
 * デザインと文言の正本は Figma「v8 Topos — PC / SP」（ページ2）。
 * 流れ：社会課題 → 埋もれた考えの3つの場所（未検討の論点・理解のちがい・発言の割合）→ 生徒の振り返り
 *       → 先生にとっての価値 → 学習指導要領との関係 → 使い方 → よくある質問 → ログイン／利用の申し込み。
 * 機能の説明はアプリの仕様に合わせる（事前の意見の本文は本人だけ、未検討の論点は議論中に教員へ届き、全員に出すかは教員が決める）。
 */

export const metadata: Metadata = {
  title: { absolute: "Topos — 誰の考えも埋もれない議論を、すべての教室に。" },
  description: "事前の意見と議論の記録から、話題にならなかった考えを拾い上げる。生徒の振り返りと、先生の次の授業につなげる。",
  openGraph: { title: "Topos — 誰の考えも埋もれない議論を、すべての教室に。", description: "事前の意見と議論の記録から、話題にならなかった考えを拾い上げる。生徒の振り返りと、先生の次の授業につなげる。", locale: "ja_JP", type: "website" },
};

export default function LpPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font -- 見出しの極太（900）は LP だけで使う */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700;900&display=swap" precedence="default" />
      <ToposLp />
    </>
  );
}
