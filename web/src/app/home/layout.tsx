import type { Viewport } from "next";
import type { ReactNode } from "react";

// ホームのヘッダーとブラウザ上部・安全領域を同じ色にする。
export const viewport: Viewport = { themeColor: "#f8fafd" };
export default function HomeLayout({ children }: { children: ReactNode }) { return children; }
