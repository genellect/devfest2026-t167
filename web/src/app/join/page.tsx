"use client";
import { Suspense } from "react";
import { JoinForm } from "@/components/JoinForm";
import { AppShell } from "@/components/shell";
import styles from "../home/mobile-home.module.css";
import formStyles from "@/components/mobile/action-form.module.css";

/** P1 参加コード入力。QR コードからは ?code=000000 付きで開き、そのまま参加する */
export default function JoinPage() {
  return (
    <AppShell back="/home" title="参加" className={`${styles.mobile} ${formStyles.shell}`} account={false} showDemo={false}>
      <div className="flow">
        <Suspense><JoinForm autoJoin simple /></Suspense>
      </div>
    </AppShell>
  );
}
