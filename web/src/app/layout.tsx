import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./material.css";
import "./app.css";
import { LoginGate } from "@/components/LoginGate";

export const metadata: Metadata = { title: "Discuss", description: "議論の前に全員の考えを集め、話し合いのずれを見つけるグループディスカッション支援" };
// viewport-fit=cover で、iPhone の下の余白（env(safe-area-inset-*)）を CSS で扱えるようにする
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f8fafd" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/* Figma と同じ書体。読み込めないときは globals.css の代替書体で表示する */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap" rel="stylesheet" />
      </head>
      <body><LoginGate>{children}</LoginGate></body>
    </html>
  );
}
