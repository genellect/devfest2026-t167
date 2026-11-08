import { APP_NAME } from "@/lib/brand";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./material.css";
import "./app.css";
import "./board.css";
import { LoginGate } from "@/components/LoginGate";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "議論の前に全員の考えを集め、話し合いのずれを見つけるグループディスカッション支援",
  applicationName: APP_NAME,
  // ホーム画面に追加したとき、iPhone でもブラウザの枠なしで開く
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
// viewport-fit=cover で、iPhone の下の余白（env(safe-area-inset-*)）を CSS で扱えるようにする
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f8fafd" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/* 本文・見出しは共通のRoboto／Noto Sans JP。読み込めない場合もシステム書体で操作できる */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Roboto:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body><LoginGate>{children}</LoginGate></body>
    </html>
  );
}
