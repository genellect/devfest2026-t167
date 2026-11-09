"use client";
import { Suspense } from "react";
import { JoinForm } from "@/components/JoinForm";
import { AppShell } from "@/components/shell";

/** P1 参加コード入力（Figma「最新」の参加カード）。QR コードからは ?code=000000 付きで開き、そのまま参加する */
export default function JoinPage() {
  return (
    <AppShell back="/home" title="参加する">
      <div className="flow ws">
        <Suspense><JoinForm autoJoin /></Suspense>
      </div>
    </AppShell>
  );
}
