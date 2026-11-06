import { redirect } from "next/navigation";
// 旧ブックマークからの移動。固定ロールの登録は行わない。
export default function Signup() { redirect("/home"); }
