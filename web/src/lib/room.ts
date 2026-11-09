"use client";
import { useEffect, useState } from "react";
import type { Timestamp } from "firebase/firestore";
import { ensureSignedIn } from "./firebase";
import { useRoomFeed } from "./room-stream";
import type { Phase } from "@/components/ui";

export interface Room {
  classroomCourseId?: string; classroomCourseName?: string; classroomCourseSection?: string;
  title: string; flowVersion?: 1; startedAt?: Timestamp; endsAt?: Timestamp; endedAt?: Timestamp; endReason?: "host" | "timeout"; publishOnEnd?: boolean; participantView?: { theme: boolean; timer: boolean; members: boolean; speaking?: boolean }; theme?: string; minutes?: number; groupSelection?: "host" | "participant"; resultsPublished?: boolean; phase: Phase; joinCode?: string; createdBy: string; groups?: number;
  /** 議論を録音して分析するか（既定は録音する）。false の部屋では録音の画面を出さない */
  recording?: boolean;
  /** グループごとの進行（キーはグループ番号）。生徒が議論を終えると consensus、全員の一文がそろって結果が出ると done */
  groupState?: Record<string, {
    status?: GroupStatus; total?: number; opinions?: number; submitted?: number; startedAt?: Timestamp;
    /** 録音の分析の状態（POST /rooms/{部屋}/groups/recording が書く。本文は含まない） */
    recording?: { status?: "analyzing" | "done" | "failed" };
  }>;
  phaseChangedAt?: Partial<Record<Phase, Timestamp>>;
  analysis?: { status: "idle" | "running" | "done" | "failed"; startedAt?: Timestamp; error?: string };
  /** 部屋全体の合意の分析（POST /rooms/{部屋}/consensus/analyze が書く） */
  consensusAnalysis?: { status?: "running" | "done" | "failed" };
  /** 任意のクラス名と、セッションが閉じる時刻（作成から3時間） */
  className?: string; expiresAt?: Timestamp;
}
export interface Message { id: string; uid: string; text: string; createdAt?: Timestamp }
export interface LiveGroupOverview { source: "gemini" | "mock"; groups: { group: number; focus: string; points: string[] }[]; updatedAt?: Timestamp }
export interface Insight { kind?: "missing" | "new_angle"; id: string; summary: string; status: "pending" | "approved" | "dismissed"; source?: string; approvedAt?: Timestamp }
export interface Member { id: string; role: "host" | "participant"; status?: "active" | "inactive"; displayName?: string; ready?: boolean; attendees?: { id: string; displayName: string; voiceRegistered: boolean }[]; group?: number }
export interface Coverage { total: number; discussed: number; reflectionRate: number | null; source?: string; points?: { summary: string; discussed: boolean }[] }
export interface Summary {
  respondents: number;
  groups: { label: string; members: number[] }[];
  metrics: { reflectionRate: number | null; alignmentRate: number | null; participationFairness: number | null; interventionEffectiveness: number | null };
  /** クラス内のグループごとの、合意の理解の分かれ方 */
  byGroup?: { group: number; respondents: number; alignmentRate: number | null; clusters: { label: string; count: number }[] }[];
  source?: string;
}
/** グループの段階。opinions（メンバー集め・事前意見）→ discussing → consensus（結論の一文）→ done（結果） */
export type GroupStatus = "opinions" | "discussing" | "consensus" | "done";
export const groupStatus = (room: Room, g: number): GroupStatus => room.groupState?.[String(g)]?.status ?? "opinions";

/** グループの結果（rooms/{部屋}/results/group-{番号}） */
export interface GroupResult { group: number; respondents: number; clusters: { label: string; count: number }[]; alignmentRate: number | null; source?: string }
/** 部屋内の認可済み結果を同じ1接続から受け取る。 */
export const useGroupResults = (roomId: string, on: boolean) =>
  useRoomFeed(on ? roomId : undefined).collections[`sessions/${roomId}/results`]?.filter((r) => r.id.startsWith("group-")).map((r) => r as unknown as GroupResult & { id: string }).sort((a, b) => a.group - b.group) ?? [];

export interface Progress {
  participants: number; opinions: number; statements: number;
  byGroup?: { group: number; participants: number; opinions: number; statements: number }[];
}

/**
 * 音声の議論の分析結果（グループごと）。rooms/{部屋}/results/flow-g{グループ番号} に API が書く
 * （POST /rooms/{部屋}/groups/recording）。届くまでは、デモのときだけ見本を表示する。
 */
export interface Flow {
  /** false なら、録音から議論を聞き取れなかった */
  speechDetected?: boolean;
  totalMinutes: number;
  segments: { topic: string; minutes: number; highlight?: boolean }[];
  flowNote?: string;
  good: { at: string; text: string }[];
  review: { at: string; text: string; question?: string }[];
  /** 先生向けの指導の提案（個人名を挙げない） */
  teacherSuggestions?: string[];
  source?: string;
}

/**
 * 録音と事前の意見を照らし合わせた論点（グループごと）。rooms/{部屋}/results/points-g{グループ番号} に API が書く。
 * 非公開の意見から作るので、先生だけに配信される。at は、その論点に最初に触れた録音の経過時間
 */
export interface GroupPoints {
  points: { summary: string; discussed: boolean; at?: string }[];
  /** 照らし合わせた事前の意見の数 */
  opinions: number;
  source?: string;
}

/** ログイン後の uid（匿名を含む） */
export function useUid() {
  const [uid, setUid] = useState<string>();
  useEffect(() => { ensureSignedIn().then((u) => setUid(u.uid)).catch(() => { window.location.replace("/"); }); }, []);
  return uid;
}

/** クライアントからFirestoreを直接読まず、同じ部屋の配信を共有する。 */
export function useDoc<T>(path: string | undefined) {
  const roomId = path?.match(/^sessions\/([^/]+)/)?.[1];
  const feed = useRoomFeed(roomId);
  const value = path ? feed.docs[path] : undefined;
  const parts = path?.split("/");
  const collection = parts && parts.length === 4 ? feed.collections[parts.slice(0, 3).join("/")] : undefined;
  return { data: (value !== undefined ? value : collection?.find((v) => v.id === parts?.[3])) as T | null | undefined, error: feed.error };
}
export const useMessages = (roomId: string, on: boolean) => (useRoomFeed(on ? roomId : undefined).collections[`sessions/${roomId}/messages`] ?? []) as Message[];
export const useMembers = (roomId: string, on: boolean) => (useRoomFeed(on ? roomId : undefined).collections[`sessions/${roomId}/members`] ?? []) as Member[];
export const useInsights = (roomId: string, on: boolean, approvedOnly: boolean) => ((useRoomFeed(on ? roomId : undefined).collections[`sessions/${roomId}/insights`] ?? []) as Insight[]).filter((r) => !approvedOnly || r.status === "approved");

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

export interface GroupConfig { id: string; groupId: string; name: string; number: number; recorderUid?: string | null; recorderName?: string | null }
export const useGroups = (roomId: string) => (useRoomFeed(roomId).collections[`sessions/${roomId}/groups`] ?? []) as unknown as GroupConfig[];
