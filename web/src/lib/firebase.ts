"use client";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence, browserSessionPersistence, connectAuthEmulator,
  getAuth, indexedDBLocalPersistence, initializeAuth, signInAnonymously, type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

/** App Hosting では FIREBASE_WEBAPP_CONFIG が自動で入るので引数なしで初期化する。ローカルはエミュレータに接続する */
export function firebase() {
  if (!app) {
    app = getApps()[0] ?? (useEmulators
      ? initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, apiKey: "demo-key", authDomain: "localhost" }) // submit-allow: エミュレータ専用のダミー。authDomain は「Googleでログイン」のポップアップに要る
      : initializeApp());
    // 匿名のローカル開発では OAuth iframe を先読みせず、外部通信を待たない。
    auth = useEmulators
      ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })
      : getAuth(app);
    db = getFirestore(app);
    if (useEmulators) {
      connectAuthEmulator(auth, `http://127.0.0.1:${process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? 9099}`, { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? 8080));
    }
  }
  return { app: app!, auth: auth!, db: db! };
}

/** 参加者は匿名ログイン。同じブラウザなら再読み込みしても同じ参加者に戻る */
export async function ensureSignedIn() {
  const { auth } = firebase();
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!;
}
