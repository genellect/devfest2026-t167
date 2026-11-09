"use client";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence, browserSessionPersistence, connectAuthEmulator,
  getAuth, indexedDBLocalPersistence, initializeAuth, type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
import { publicFirebaseConfig } from "./firebase-config";

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

/** App Hosting では FIREBASE_WEBAPP_CONFIG が自動で入るので引数なしで初期化する。ローカルはエミュレータに接続する */
export function firebase() {
  if (!app) {
    const options = useEmulators ? undefined : publicFirebaseConfig({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
    app = getApps()[0] ?? (useEmulators
      ? initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, apiKey: "demo-key", authDomain: "localhost" }) // submit-allow: エミュレータ専用のダミー。authDomain は「Googleでログイン」のポップアップに要る
      : options ? initializeApp(options) : initializeApp());
    // 模擬Google認証のローカル開発では OAuth iframe を先読みせず、外部通信を待たない。
    auth = useEmulators
      ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })
      : getAuth(app);
    // スマホのlocalhostはスマホ自身。LAN確認では画面と同じ入口でエミュレータを中継する。
    const preview = useEmulators && typeof window !== "undefined"
      && (window.location.protocol === "https:" || !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname));
    db = preview ? initializeFirestore(app, {
      host: window.location.host, ssl: window.location.protocol === "https:", experimentalForceLongPolling: true,
    }) : getFirestore(app);
    if (useEmulators) {
      // 同じWi-Fiの別端末でも、Next.js経由でMac内の認証エミュレータへ接続する。
      const authOrigin = typeof window === "undefined" ? `http://127.0.0.1:${process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? 9099}` : window.location.origin;
      connectAuthEmulator(auth, authOrigin, { disableWarnings: true });
      if (!preview) connectFirestoreEmulator(db, "127.0.0.1", Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? 8080));
    }
  }
  return { app: app!, auth: auth!, db: db! };
}

/** 生徒も教師もGoogleログイン必須。認証を暗黙に作成しない */
export async function ensureSignedIn() {
  const { auth } = firebase();
  await auth.authStateReady();
  if (!auth.currentUser || !auth.currentUser.providerData.some((provider) => provider.providerId === 'google.com')) {
    throw new Error('Googleでログインしてから参加してください');
  }
  return auth.currentUser!;
}
