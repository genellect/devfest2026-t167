import type { MetadataRoute } from "next";
import { LP_URL } from "@/lib/lp-config";

/** 公開する紹介ページだけを検索エンジンへ案内する。 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: LP_URL }];
}
