"use client";
import { useEffect, useState } from "react";
import {
  collection, doc, onSnapshot, orderBy, query, where,
  type DocumentData, type Query, type DocumentReference, type Timestamp,
} from "firebase/firestore";
import { ensureSignedIn, firebase } from "./firebase";
import type { Phase } from "@/components/ui";

export interface Room {
  title: string; phase: Phase; joinCode?: string; createdBy: string;
  phaseChangedAt?: Partial<Record<Phase, Timestamp>>;
  analysis?: { status: "idle" | "running" | "done" | "failed"; startedAt?: Timestamp; error?: string };
}
export interface Message { id: string; uid: string; text: string; createdAt?: Timestamp }
export interface Insight { id: string; summary: string; status: "pending" | "approved"; source?: string; approvedAt?: Timestamp }
export interface Member { id: string; role: "moderator" | "participant" }
export interface Coverage { total: number; discussed: number; reflectionRate: number | null; source?: string }
export interface Summary {
  respondents: number;
  groups: { label: string; members: number[] }[];
  metrics: { reflectionRate: number | null; alignmentRate: number | null; participationFairness: number | null; interventionEffectiveness: number | null };
  source?: string;
}

/** ログイン後の uid（匿名を含む） */
export function useUid() {
  const [uid, setUid] = useState<string>();
  useEffect(() => { ensureSignedIn().then((u) => setUid(u.uid)); }, []);
  return uid;
}

/** 1つのドキュメントを購読する。path が undefined の間は何もしない */
export function useDoc<T>(path: string | undefined) {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!path) return;
    const ref = doc(firebase().db, path) as DocumentReference<DocumentData>;
    return onSnapshot(ref, (s) => setData(s.exists() ? (s.data() as T) : null), (e) => setError(e.message));
  }, [path]);
  return { data, error };
}

/** コレクションのクエリを購読する。key が変わったときだけ購読し直す */
export function useQuery<T>(key: string | undefined, build: () => Query<DocumentData>) {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    if (!key) return;
    return onSnapshot(build(), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }) as T)), () => setItems([]));
    // build は key で決まるので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return items;
}

const db = () => firebase().db;
export const useMessages = (roomId: string, on: boolean) =>
  useQuery<Message>(on ? `m:${roomId}` : undefined, () => query(collection(db(), `rooms/${roomId}/messages`), orderBy("createdAt")));
export const useMembers = (roomId: string, on: boolean) =>
  useQuery<Member>(on ? `mem:${roomId}` : undefined, () => collection(db(), `rooms/${roomId}/members`));
/** 司会者はすべての提案、参加者は承認済みだけ（Rules と同じ条件で問い合わせる） */
export const useInsights = (roomId: string, on: boolean, approvedOnly: boolean) =>
  useQuery<Insight>(on ? `i:${roomId}:${approvedOnly}` : undefined, () => approvedOnly
    ? query(collection(db(), `rooms/${roomId}/insights`), where("status", "==", "approved"))
    : collection(db(), `rooms/${roomId}/insights`));

/** Firestore の時刻をミリ秒に（書き込み直後でまだ時刻がないときは undefined） */
export const millis = (t?: Timestamp) => (t && typeof t.toMillis === "function" ? t.toMillis() : undefined);

/** 残り時間を mm:ss で返す。1秒ごとに更新する */
export function useCountdown(startMs: number | undefined, minutes: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!startMs) return { text: `${String(minutes).padStart(2, "0")}:00`, over: false };
  const left = Math.max(0, startMs + minutes * 60_000 - now);
  const s = Math.ceil(left / 1000);
  return { text: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`, over: left === 0 };
}
