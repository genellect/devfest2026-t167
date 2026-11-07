"use client";

import {
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { firebase } from "./firebase";
import { beginSignIn, endSignIn, establishSession, logoutSession, unlockSession, useAppSession } from "./session";
import { clearJoinCode } from "./join-code";

/** 全利用者がGoogleで本人認証する。Host権限はセッション作成時にAPIが付与する */
export function useHostUser() {
  return useAppSession().user;
}
/**
 * 招待された教員か（管理者が付けた teacher claim）。画面の振り分けにだけ使い、権限はAPIが確かめる。
 * 読み込み中は undefined、ログインしていなければ false。
 */
export function useIsTeacher(): boolean | undefined {
  const user = useHostUser();
  const [teacher, setTeacher] = useState<{ uid: string; value: boolean }>();
  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdTokenResult().then((r) => { if (active) setTeacher({ uid: user.uid, value: r.claims.teacher === true }); })
      .catch(() => { if (active) setTeacher({ uid: user.uid, value: false }); });
    return () => { active = false; };
  }, [user]);
  if (user === null) return false;
  if (!user || teacher?.uid !== user.uid) return undefined;
  return teacher.value;
}
/** ログインのあとに開く画面：QRやリンクから来た人は参加、教員は教員のホーム、それ以外は参加コードの入力 */
export function homePath(teacher: boolean) { return teacher ? "/teacher" : "/join"; }
export interface LoginOptions { isSharedDevice: boolean; classEndsAt: number | null }
async function login(how: () => Promise<unknown>, options: LoginOptions) {
  beginSignIn();
  try { await how(); await establishSession(options); }
  finally { endSignIn(); }
}
export async function signInAsHost(options: LoginOptions = { isSharedDevice: false, classEndsAt: null }) {
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
