import { redirect } from "next/navigation";

/** 旧設定画面のURLも共通設定に引き継ぐ。 */
export default function ProfilePage() { redirect("/settings"); }
