"use client";
/**
 * この端末だけに残す記録（ブラウザの localStorage）。
 * 個人の目標・振り返り・参加した議論の一覧は、サーバーに送らず本人の端末にだけ置く。
 * 読み書きできない環境（プライベートブラウズなど）でも画面は動くようにする。
 */
export interface HistoryItem { roomId: string; title: string; at: number; note?: string }
export interface Reflection { goal?: string; achieved?: string; spoke?: string; nextGoal?: string; ifAgain?: string; savedAt?: number }

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
  if (patch.nextGoal) write("t167.nextGoal", { text: patch.nextGoal, at: Date.now() });
}
/** 前回の振り返りで決めた「次に挑戦したいこと」 */
export const getNextGoal = () => read<{ text: string; at: number } | null>("t167.nextGoal", null);

/** 先生が決めた議論の時間（分）。部屋ごとにこの端末に残す */
export const getDuration = (roomId: string) => read<number>(`t167.duration.${roomId}`, 15);
export const setDuration = (roomId: string, minutes: number) => write(`t167.duration.${roomId}`, minutes);

export const shortDate = (at: number) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()}`; };
