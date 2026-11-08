"use client";
/**
 * この端末だけに残す記録（ブラウザの localStorage）。
 * 個人の振り返り・参加した議論の一覧は、サーバーに送らず本人の端末にだけ置く。
 * 読み書きできない環境（プライベートブラウズなど）でも画面は動くようにする。
 */
export interface HistoryItem { roomId: string; title: string; at: number; note?: string }
export interface Reflection { spoke?: string; ifAgain?: string; savedAt?: number }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できなくても画面は続ける */ }
}

const HISTORY = (role: "host" | "participant") => `t167.history.${role}`;
export const getHistory = (role: "host" | "participant") => read<HistoryItem[]>(HISTORY(role), []);
export function addHistory(role: "host" | "participant", item: Omit<HistoryItem, "at">) {
  const list = getHistory(role).filter((x) => x.roomId !== item.roomId);
  write(HISTORY(role), [{ ...item, at: Date.now() }, ...list].slice(0, 20));
}

export const getReflection = (roomId: string) => read<Reflection>(`t167.reflection.${roomId}`, {});
export function saveReflection(roomId: string, patch: Reflection) {
  write(`t167.reflection.${roomId}`, { ...getReflection(roomId), ...patch });
}
/** 部屋ごとの「クラス・授業名」（ヘッダーの小さな表示に使う） */
export const getRoomLabel = (roomId: string) => read<string>(`t167.roomLabel.${roomId}`, "");
export const setRoomLabel = (roomId: string, label: string) => write(`t167.roomLabel.${roomId}`, label);
