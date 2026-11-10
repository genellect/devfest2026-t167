/** 公開する LP と、Firebase 作成時に登録した既存の GA4 Web ストリーム。秘密情報ではない。 */
export const SITE_ORIGIN = "https://web--devfest2026-t167.asia-east1.hosted.app";
export const LP_URL = `${SITE_ORIGIN}/lp`;
export const LP_MEASUREMENT_ID = "G-YEDJKQME2G";
export const LP_TITLE = "Topos — 誰の考えも埋もれない議論を、すべての教室に。";

/** 参照元は外部サイトの origin だけ。参加コード・検索語・メールなどを含むパスやクエリは送らない。 */
export function lpReferrer(referrer: string): string {
  try {
    const url = new URL(referrer);
    return ["https:", "http:"].includes(url.protocol) && url.origin !== SITE_ORIGIN ? `${url.origin}/` : "";
  } catch { return ""; }
}
