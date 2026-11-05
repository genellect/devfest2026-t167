"use client";
import { useEffect, useState } from "react";
import {
  browserPopupRedirectResolver, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, type User,
} from "firebase/auth";
import { firebase } from "./firebase";

/** 先生（司会者）は Google でログインする。匿名のままでは部屋を作れない（API が 403 を返す） */
export function useHostUser() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(firebase().auth, (u) => setUser(u && !u.isAnonymous ? u : null)), []);
  return user;
}

export async function signInAsHost() {
  // ローカルの Auth は先読みを省いて初期化しているので、ポップアップの仕組みをここで渡す
  await signInWithPopup(firebase().auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
}

/** エミュレータで動かしているときだけ使う。firebase/seed.mjs のテスト用の先生でログインする */
export const canUseTestHost = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
export async function signInAsTestHost() {
  await signInWithEmailAndPassword(firebase().auth, "mod@example.com", "password"); // submit-allow: エミュレータ専用のダミー
}

/** エミュレータで動かしているときだけ使う。firebase/seed.mjs のテスト用の生徒でログインする */
export async function signInAsTestStudent() {
  await signInWithEmailAndPassword(firebase().auth, "p1@example.com", "password"); // submit-allow: エミュレータ専用のダミー
}

export async function signOutHost() {
  await signOut(firebase().auth);
}
