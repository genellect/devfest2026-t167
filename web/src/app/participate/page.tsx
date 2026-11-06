import { redirect } from "next/navigation";
/** 教員と学生の分岐はなくした（Docs「UIフィードバック」）。以前のリンクは参加画面へ送る */
export default function Participate() { redirect("/join"); }
