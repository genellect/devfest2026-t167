"use client";

import {
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithCredential, signInWithPopup, reauthenticateWithPopup,
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
/** エミュレータで動かしているときだけ使う。権限はseedの管理側付与に従う。 */
export const canUseTestHost = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
async function testGoogle(kind: "teacher" | "student", options: LoginOptions) {
  if (!canUseTestHost) throw new Error("このログインはエミュレータ専用です");
  await login(() => signInWithCredential(firebase().auth, GoogleAuthProvider.credential(JSON.stringify({
    sub: `local-${kind}`, email: `local-${kind}@example.com`, email_verified: true, name: kind,
  }))), options);
}
export const signInAsTestHost = (options: LoginOptions = { isSharedDevice: false, classEndsAt: null }) => testGoogle("teacher", options);
export const signInAsTestStudent = (options: LoginOptions = { isSharedDevice: false, classEndsAt: null }) => testGoogle("student", options);
export async function signOutHost() { await logoutSession(); clearJoinCode(); }

/** Google OAuthの内部情報を表示せず、追加許可をやり直せる案内を返す。 */
export function googleLoginError(error: unknown) {
  const code = (error as { code?: string })?.code;
  return code === "auth/popup-closed-by-user" ? "Googleの接続をキャンセルしました" : code === "auth/popup-blocked" ? "ポップアップを許可して、もう一度お試しください" : "Googleの許可を確認してください。ログイン中と同じGoogleアカウントを選んでください";
}
