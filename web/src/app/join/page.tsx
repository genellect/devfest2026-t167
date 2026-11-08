import { redirect } from "next/navigation";
import { normalizeJoinCode } from "@/lib/join-code";

/** 古い参加URLの互換入口。独立した入力画面は表示せず、ホームへ統合する。 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  const normalized = typeof code === "string" ? normalizeJoinCode(code) : "";
  redirect(normalized.length === 6 ? `/home?code=${encodeURIComponent(normalized)}` : "/home");
}
