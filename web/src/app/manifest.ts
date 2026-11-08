import type { MetadataRoute } from "next";

/** ホーム画面に追加したときの名前・アイコン・色（Docs「サービス形態」：PWA） */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Topos — 誰の考えも埋もれない議論を、すべての教室に。",
    short_name: "Topos",
    description: "議論の前に全員の考えを集め、まだ話されていない論点と合意のずれを AI が見つけるグループディスカッション支援",
    lang: "ja",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f6f4",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
