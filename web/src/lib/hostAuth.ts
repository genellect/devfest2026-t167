"use client";

import {
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup,
} from "firebase/auth";
import { firebase } from "./firebase";
import { beginSignIn, endSignIn, establishSession, logoutSession, unlockSession, useAppSession } from "./session";
import { clearJoinCode } from "./join-code";

/** 全利用者がGoogleで本人認証する。Host権限はセッション作成時にAPIが付与する */
export function useHostUser() {
  return useAppSession().user;
}
export interface LoginOptions { isSharedDevice: boolean; classEndsAt: number | null }
async function login(how: () => Promise<unknown>, options: LoginOptions) {
  beginSignIn();
  try { await how(); await establishSession(options); }
  finally { endSignIn(); }
}
export async function signInAsHost(options: LoginOptions = { isSharedDevice: false, classEndsAt: null }) {
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_EMULATORS === "1") {
    const { signInMockGoogle } = await import("./mock-google");
    await login(signInMockGoogle, options);
    return;
  }
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  await login(() => signInWithPopup(firebase().auth, provider, browserPopupRedirectResolver), options);
}
export async function reauthenticateSession() {
  const user = firebase().auth.currentUser;
  if (!user) throw new Error("Googleでログインしてください");
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account", login_hint: user.email ?? "" });
  await unlockSession(() => reauthenticateWithPopup(user, provider, browserPopupRedirectResolver));
}
/** SDKの生のエラーやアカウント情報を画面へ出さず、本人が対処できる案内にする。 */
export function googleLoginError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "auth/popup-blocked") return "ポップアップがブロックされています。このサイトのポップアップを許可して、もう一度お試しください。";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Googleのログインが完了しませんでした。もう一度お試しください。";
  if (code === "cookie_unavailable") return "ログインに必要なCookieを確認できません。このサイトのCookieを許可して、もう一度お試しください。";
  if (code === "auth/web-storage-unsupported") return "ログイン情報を保存できません。このサイトのCookieとサイトデータを許可してください。";
  return "ログインできませんでした。接続を確認して、もう一度お試しください。";
}
export async function signOutHost() { await logoutSession(); clearJoinCode(); }
