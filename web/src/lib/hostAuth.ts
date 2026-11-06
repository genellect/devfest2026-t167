"use client";
import { useEffect, useState } from "react";
import {
  browserPopupRedirectResolver, GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut, type User,
} from "firebase/auth";
import { firebase } from "./firebase";
import { clearJoinCode } from "./join-code";

/** 先生（司会者）は Google でログインする。教師claimがなければ部屋を作れない（API が 403 を返す） */
export function useHostUser() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(firebase().auth, (u) => setUser(u?.providerData.some((provider) => provider.providerId === "google.com") ? u : null)), []);
  return user;
}

export async function signInAsHost() {
  // ローカルの Auth は先読みを省いて初期化しているので、ポップアップの仕組みをここで渡す
  await signInWithPopup(firebase().auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
}

/** エミュレータで動かしているときだけ使う。firebase/seed.mjs のテスト用の先生でログインする */
export const canUseTestHost = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
async function testGoogle(kind: "teacher" | "student") {
  if (!canUseTestHost) throw new Error("このログインはエミュレータ専用です");
  await signInWithCredential(firebase().auth, GoogleAuthProvider.credential(JSON.stringify({
    sub: `local-${kind}`, email: `local-${kind}@example.com`, email_verified: true, name: kind,
  })));
}
export const signInAsTestHost = () => testGoogle("teacher");
export const signInAsTestStudent = () => testGoogle("student");

export async function signOutHost() {
  await signOut(firebase().auth);
  clearJoinCode();
}

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
