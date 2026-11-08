import { APP_NAME } from "@/lib/brand";
import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import DiscussionHistory from "@/components/history/DiscussionHistory";
import { Loading } from "@/components/ui";
export const metadata: Metadata = { title: `${APP_NAME} | 議論の履歴` };
export const viewport: Viewport = { themeColor: "#f8fafd" };
export default function HistoryPage() { return <Suspense fallback={<Loading />}><DiscussionHistory /></Suspense>; }
