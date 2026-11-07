import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./material.css";
import "./app.css";
import "./board.css";
import { LoginGate } from "@/components/LoginGate";

export const metadata: Metadata = {
  title: "Discuss",
  description: "議論の前に全員の考えを集め、話し合いのずれを見つけるグループディスカッション支援",
  applicationName: "Discuss",
  // ホーム画面に追加したとき、iPhone でもブラウザの枠なしで開く
  appleWebApp: { capable: true, title: "Discuss", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
// viewport-fit=cover で、iPhone の下の余白（env(safe-area-inset-*)）を CSS で扱えるようにする
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#fafbf8" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/* 本文は BIZ UDPゴシック（教科書・配布物のユニバーサルデザイン書体）、見出しと数字は Zen Maru Gothic。読み込めないときは board.css の代替書体で表示する */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Maru+Gothic:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body><LoginGate>{children}</LoginGate></body>
    </html>
  );
}
