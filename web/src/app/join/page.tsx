"use client";
import { Suspense } from "react";
import { JoinForm } from "@/components/JoinForm";
import { AppShell } from "@/components/shell";

/** P1 参加コード入力。QR コードからは ?code=000000 付きで開き、そのまま参加する */
export default function JoinPage() {
  return (
    <AppShell title="参加">
      <div className="flow">
        <Suspense><JoinForm autoJoin /></Suspense>
      </div>
    </AppShell>
  );
}
