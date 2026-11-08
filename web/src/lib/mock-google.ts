"use client";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { firebase } from "./firebase";

/** 開発中のクリック確認用。本人認証だけをモック化し、セッション作成・認可は通常のAPIを使う。 */
export async function signInMockGoogle() {
  const { auth } = firebase();
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_PUBLIC_USE_EMULATORS !== "1" || !auth.emulatorConfig) {
    throw new Error("模擬認証は開発用エミュレータでのみ利用できます");
  }
  let subject = localStorage.getItem("discuss-mock-google-subject");
  if (!subject) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    subject = `mock-${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
    localStorage.setItem("discuss-mock-google-subject", subject);
  }
  // Authエミュレータが解釈する架空のGoogle ID。実Googleには送信しない。
  const credential = GoogleAuthProvider.credential(JSON.stringify({
    sub: subject, email: `${subject}@example.com`, email_verified: true, name: "デモ参加者",
  }));
  await signInWithCredential(auth, credential);
}
