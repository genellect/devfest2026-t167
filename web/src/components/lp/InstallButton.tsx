"use client";
import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * Topos をホーム画面に追加する（PWA。マニフェストは app/manifest.ts）。
 * Chrome・Edge はブラウザの追加画面を開く。iPhone・iPad など追加画面がないブラウザでは、手順を表示する。
 */
export function InstallButton({ className = "lp-btn lp-btn--ghost" }: { className?: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState<"ios" | "other" | null>(null);

  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setPrompt(null);
      return;
    }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setHelp((h) => (h ? null : ios ? "ios" : "other"));
  }

  if (installed) return <p className="install__done" role="status">この端末に、Topos を追加済みです。</p>;
  return (
    <div className="install">
      <button type="button" className={className} onClick={install} aria-expanded={help !== null} aria-controls="install-help">インストール</button>
      {help && (
        <div id="install-help" className="install__help" role="note">
          {help === "ios"
            ? <ol><li>Safari の下にある共有ボタン<span aria-hidden="true">（□に↑）</span>を押す。</li><li>「ホーム画面に追加」を選ぶ。</li></ol>
            : <ol><li>ブラウザのメニューを開く。</li><li>「アプリをインストール」か「ホーム画面に追加」を選ぶ。</li></ol>}
        </div>
      )}
    </div>
  );
}
