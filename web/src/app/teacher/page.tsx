import { redirect } from "next/navigation";

/** 以前の教員ホームのURLも共通ホームへ引き継ぐ。 */
export default function TeacherHome() {
  redirect("/home");
}
