"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHostUser } from "@/lib/hostAuth";


export type NavRole = "host" | "student";
type IconName = "home" | "create" | "help" | "settings" | "join";

const TABS: Record<NavRole, { href: string; label: string; icon: IconName }[]> = {
  host: [
    { href: "/home", label: "ホーム", icon: "home" },
    { href: "/participate", label: "参加", icon: "join" },
    { href: "/about", label: "使い方", icon: "help" },
    { href: "/host/profile", label: "設定", icon: "settings" },
  ],
  student: [
    { href: "/home", label: "ホーム", icon: "home" },
    { href: "/join", label: "参加", icon: "join" },
    { href: "/about", label: "使い方", icon: "help" },
  ],
};

/**
 * ホーム・部屋を作る・参加・使い方・設定の画面に出すタブメニュー。Header の nav に渡す。
 * スマホでは画面の下に固定し、幅 768px 以上ではヘッダーの2段目に並べる（globals.css の .tabbar）。
 * 議論中の部屋の画面には出さない（ヘッダーの「ホーム」だけにして、流れの邪魔をしない）。
 */
export function TabBar(_props: { role: NavRole }) {
  void _props;
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="メニュー">
      <ul className="tabbar__list">
        {TABS.host.map((t) => (
          <li key={t.href}>
            <Link className="tabbar__item" href={t.href} aria-current={pathname === t.href ? "page" : undefined}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** 使い方のタブはログイン後だけ表示する。 */
export function AutoTabBar() {
  const user = useHostUser();
  if (!user) return null;
  return <TabBar role="host" />;
}

/** タブの絵。文字の色（currentColor）の太い線で描く。意味はラベルの文字で伝えるので、読み上げからは外す */
function Icon({ name }: { name: IconName }) {
  return (
    <svg className="tabbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "home" && <><path d="M3 11 12 3.5 21 11" /><path d="M5.5 9.5V20.5h5v-6h3v6h5V9.5" /></>}
      {name === "create" && <><rect x="3.5" y="3.5" width="17" height="17" /><path d="M12 8v8M8 12h8" /></>}
      {name === "help" && <><circle cx="12" cy="12" r="8.75" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.25c-.75.35-1.2.95-1.2 1.75v.6" /><path d="M12 17.25v.01" /></>}
      {name === "settings" && <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.25" /><circle cx="9" cy="17" r="2.25" /></>}
      {name === "join" && <><path d="M14 4h5.5v16H14" /><path d="M3.5 12h11" /><path d="M10.5 8l4 4-4 4" /></>}
    </svg>
  );
}
