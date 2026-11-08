import { redirect } from "next/navigation";
/** 旧URLの参加リンクも共通ホームへ引き継ぐ。認証は既存のLoginGateで検査する。 */
export default async function TeacherHome({ searchParams }: { searchParams: Promise<{ code?: string; join?: string }> }) {
  const { code, join } = await searchParams;
  const query = new URLSearchParams();
  if (typeof code === "string") query.set("code", code);
  if (join === "1") query.set("join", join);
  redirect(`/home${query.size ? `?${query}` : ""}`);
}
