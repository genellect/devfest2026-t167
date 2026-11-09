"use client";
import { usePathname } from "next/navigation";
import { MobileWorkspace } from "./MobileWorkspace";
import { MobileActionPage } from "./MobileActionPage";

/** メニューを保ったまま、背面のページを先に切り替える。 */
export function MobileRouteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const action = pathname === "/join" ? "参加する" : pathname === "/host/new" ? "ホストする" : undefined;
  const view = pathname === "/home" || action ? "home" : pathname === "/history" ? "history" : pathname === "/settings" ? "settings" : undefined;
  if (!view) return children;
  return <>
    <div inert={!!action} aria-hidden={action ? true : undefined}><MobileWorkspace view={view} /></div>
    {action && <MobileActionPage key={pathname} title={action}>{children}</MobileActionPage>}
  </>;
}
