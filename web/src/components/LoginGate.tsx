"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHostUser } from "@/lib/hostAuth";
import { rememberJoinCode } from "@/lib/join-code";
import { Loading } from "./ui";

/** ログイン・プライバシー以外は、認証が確定するまで画面を表示しない。API/Rulesの認可も維持する。 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const user = useHostUser();
  const pathname = usePathname();
  const router = useRouter();
  const publicPage = pathname === "/" || pathname === "/about";
  useEffect(() => {
    if (publicPage || user !== null) return;
    if (pathname === "/join") rememberJoinCode(new URLSearchParams(window.location.search).get("code") ?? "");
    router.replace("/");
  }, [pathname, publicPage, user, router]);
  if (!publicPage && !user) return <Loading label="ログインを確認しています…" />;
  return children;
}
