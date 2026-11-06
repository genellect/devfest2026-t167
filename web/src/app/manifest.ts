import type { MetadataRoute } from "next";

/** ホーム画面に追加したときの名前・アイコン・色（Docs「サービス形態」：PWA） */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Discuss",
    short_name: "Discuss",
    description: "議論の前に全員の考えを集め、話し合いのずれを見つけるグループディスカッション支援",
    lang: "ja",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8fafd",
    theme_color: "#f8fafd",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
