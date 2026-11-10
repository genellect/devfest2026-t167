"use client";
import { useEffect, useRef } from "react";
import { LP_MEASUREMENT_ID, LP_TITLE, LP_URL, SITE_ORIGIN, lpReferrer } from "@/lib/lp-config";

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  toposLpTagInitialized?: boolean;
} & Partial<Record<`ga-disable-${typeof LP_MEASUREMENT_ID}`, boolean>>;

/** GA4 は本番の紹介ページだけ。アプリへ出るときは送信を止める。 */
export function LpAnalytics() {
  const viewed = useRef(false);
  useEffect(() => {
    if (window.location.origin !== SITE_ORIGIN || window.location.pathname !== "/lp") return;
    const analytics = window as AnalyticsWindow;
    const disabled = `ga-disable-${LP_MEASUREMENT_ID}` as const;
    // オプトアウト アドオンなどが先に止めている場合は、その選択を維持する。
    if (analytics[disabled] && !analytics.toposLpTagInitialized) return;
    analytics[disabled] = false;
    analytics.dataLayer ??= [];
    // gtag.js のキューは arguments オブジェクトを受け取る（配列ではない）。
    // eslint-disable-next-line prefer-rest-params
    analytics.gtag ??= function () { analytics.dataLayer!.push(arguments); };
    if (!analytics.toposLpTagInitialized) {
      // タグの初期化より前に、全イベントへ適用する。
      analytics.gtag("set", {
        send_page_view: false,
        page_location: LP_URL,
        page_title: LP_TITLE,
        page_referrer: lpReferrer(document.referrer),
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        cookie_path: "/lp",
        cookie_flags: "SameSite=Lax;Secure",
      });
      analytics.gtag("js", new Date());
      analytics.gtag("config", LP_MEASUREMENT_ID);
      analytics.toposLpTagInitialized = true;
      const script = document.createElement("script");
      script.id = "topos-lp-ga4";
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${LP_MEASUREMENT_ID}`;
      script.referrerPolicy = "origin";
      document.head.appendChild(script);
    }
    const pageView = () => analytics.gtag!("event", "page_view", { send_to: LP_MEASUREMENT_ID, page_location: LP_URL, page_title: LP_TITLE, page_referrer: lpReferrer(document.referrer) });
    if (!viewed.current) { pageView(); viewed.current = true; }
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || analytics[disabled]) return;
      const link = event.target.closest<HTMLAnchorElement>("a[data-lp-action]");
      const action = link?.dataset.lpAction;
      if (action !== "apply") return;
      analytics.gtag!("event", "lp_cta_click", {
        send_to: LP_MEASUREMENT_ID,
        cta_action: action,
        cta_placement: link!.closest<HTMLElement>("[data-lp-placement]")?.dataset.lpPlacement,
        page_location: LP_URL,
        page_referrer: lpReferrer(document.referrer),
      });
    };
    const stop = () => { analytics[disabled] = true; };
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted && !analytics[disabled]) pageView();
    };
    document.addEventListener("click", click);
    window.addEventListener("pageshow", resume);
    return () => {
      stop();
      document.removeEventListener("click", click);
      window.removeEventListener("pageshow", resume);
    };
  }, []);
  return null;
}
