import type { Metadata, Viewport } from "next";
import "./ds.css";
import { LoginGate } from "@/components/LoginGate";

export const metadata: Metadata = {
  // プロダクト名は Topos（README「Topos という名前」）。タブの題名は「画面名 | Topos」
  title: { default: "Topos — 誰の考えも埋もれない議論を、すべての教室に。", template: "%s | Topos" },
  description: "議論の前に全員の考えを集め、まだ話されていない論点と合意のずれを AI が見つけるグループディスカッション支援",
  applicationName: "Topos",
  // Search Console が本番ホストの所有権を確認するための公開用コード。
  verification: { google: "KzMtX0b7Jaqx9WR8lM1iGJVVMapcqk56eKgTiiMgnRs" },
  // ホーム画面に追加したとき、iPhone でもブラウザの枠なしで開く
  appleWebApp: { capable: true, title: "Topos", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
// viewport-fit=cover で、iPhone の下の余白（env(safe-area-inset-*)）を CSS で扱えるようにする
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/* 欧文と数字は Inter、和文は Noto Sans JP。読み込めないときは ds.css の代替書体（ヒラギノなど）で表示する */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body><LoginGate>{children}</LoginGate></body>
    </html>
  );
}
