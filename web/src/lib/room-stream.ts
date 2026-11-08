"use client";
import { useEffect, useState } from "react";
import { preserveRecordings } from "./recording-recovery";
import { authenticatedFetch, handleSessionFailure } from "./session";
interface RoomFeed { docs: Record<string, unknown>; collections: Record<string, { id: string }[]>; error?: string }
interface Entry { value: RoomFeed; listeners: Set<() => void>; controller: AbortController }
const streams = new Map<string, Entry>();
/** 操作成功後は同じ画面の購読を張り直し、取りこぼした状態をサーバーから取得する。 */
export function refreshRoomFeed(roomId: string) {
  const entry = streams.get(roomId);
  if (!entry) return;
  entry.controller.abort();
  entry.controller = new AbortController();
  void consume(roomId, entry);
}
function revive(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if ("__time" in value && typeof value.__time === "number") { const ms = value.__time; return { toMillis: () => ms }; }
  if (Array.isArray(value)) return value.map(revive);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
}
export function useRoomFeed(roomId: string | undefined): RoomFeed {
  const [value, setValue] = useState<RoomFeed>({ docs: {}, collections: {} });
  useEffect(() => {
    if (!roomId) return;
    let entry = streams.get(roomId);
    if (!entry) {
      entry = { value: { docs: {}, collections: {} }, listeners: new Set(), controller: new AbortController() };
      streams.set(roomId, entry); void consume(roomId, entry);
    }
    const current = entry;
    const update = () => setValue(current.value);
    current.listeners.add(update); update();
    return () => {
      current.listeners.delete(update);
      // 同一レンダーの別hookへの引き継ぎでは接続を作り直さない。
      queueMicrotask(() => { if (!current.listeners.size) { current.controller.abort(); streams.delete(roomId); } });
    };
  }, [roomId]);
  return value;
}
async function consume(roomId: string, entry: Entry) {
  const { signal } = entry.controller;
  while (!signal.aborted) {
    try {
      const response = await authenticatedFetch(`/rooms/${roomId}/live`, { signal, headers: { accept: "text/event-stream" } });
      if (!response.ok || !response.body) {
        if ([401, 423].includes(response.status)) return;
        if (response.status === 403) {
          await preserveRecordings(); entry.value = { docs: {}, collections: {}, error: "この部屋を表示できません。参加方法を確認してください。" }; entry.listeners.forEach((fn) => fn()); return;
        }
        throw new Error("接続を確認しています");
      }
      // 再接続中も既存画面と録音を維持する。削除・失効は認可済みの配信で反映する。
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const json = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (!json) continue;
          const message = JSON.parse(json);
          if (block.includes("event: failure")) {
            if (["session_locked", "session_revoked", "session_required", "unauthenticated"].includes(message.code)) { void handleSessionFailure(message.code, message.reason); return; }
            if (message.code === "not_member") { await preserveRecordings(); entry.value = { docs: {}, collections: {}, error: "この部屋を表示できません" }; entry.listeners.forEach((fn) => fn()); return; }
            throw new Error("接続を再確認しています");
          }
          const payload = revive(message) as Partial<RoomFeed>;
          entry.value = { docs: { ...entry.value.docs, ...payload.docs }, collections: { ...entry.value.collections, ...payload.collections } };
          entry.listeners.forEach((fn) => fn());
        }
      }
    } catch { if (signal.aborted) return; entry.value = { ...entry.value, error: "接続を再確認しています。録音は端末に残ります。" }; entry.listeners.forEach((fn) => fn()); }
    // 再接続の間隔を固定し、切断中に連続してAPIを叩かない。
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 3000); signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
  }
}
