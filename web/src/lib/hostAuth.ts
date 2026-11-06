"use client";
import { useEffect, useState } from "react";
import {
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithCredential, signInWithPopup, reauthenticateWithPopup, type User,
} from "firebase/auth";
import { firebase } from "./firebase";
import { beginSignIn, endSignIn, establishSession, logoutSession, unlockSession, useAppSession } from "./session";
import { clearJoinCode } from "./join-code";

/** 先生（司会者）は Google でログインする。教師claimがなければ部屋を作れない（API が 403 を返す） */
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

/** 表示用。認可の最終判断はAPIとRulesで行う。 */
export function useTeacherClaim(user: User | null | undefined) {
  const [teacher, setTeacher] = useState(false);
  useEffect(() => {
    let active = true;
    setTeacher(false);
    if (user) user.getIdTokenResult().then((result) => { if (active) setTeacher(result.claims.teacher === true); }).catch(() => {});
    return () => { active = false; };
  }, [user]);
  return teacher;
}
