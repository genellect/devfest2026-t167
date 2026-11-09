"use client";
/** 録音の所有者はFirebase UIDで分離する。内容をログ/サーバーへ出さない。 */
export interface RecoveryRecording { id: string; uid: string; roomId?: string; createdAt: number; mimeType: string; complete: boolean; chunks: number; durationMs?: number; error?: string; deleteAfter?: number }
const guards = new Set<() => Promise<void>>();
export function registerRecordingGuard(stopAndSave: () => Promise<void>) { guards.add(stopAndSave); return () => { guards.delete(stopAndSave); }; }
export async function preserveRecordings() { await Promise.all([...guards].map((save) => save())); }
const memory = new Map<string, { recording: RecoveryRecording; blob: Blob }>();
export function retainUnsavedAudio(recording: RecoveryRecording, blob: Blob) { memory.set(recording.id, { recording, blob }); }
export function unsavedAudio(uid: string) { for (const [id, row] of memory) if ((row.recording.deleteAfter ?? Infinity) <= Date.now()) memory.delete(id); return [...memory.values()].filter((r) => r.recording.uid === uid && (r.recording.deleteAfter ?? Infinity) > Date.now()); }
let opening: Promise<IDBDatabase> | undefined;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("discuss-audio-recovery", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("recordings", { keyPath: "id" }); request.result.createObjectStore("chunks", { keyPath: ["recordingId", "sequence"] }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => { opening = undefined; reject(new Error("端末内の録音保存を開始できません")); };
  });
}
async function write(store: "recordings" | "chunks", value: unknown) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error("端末の保存容量を確認してください。録音はこの画面に保持しています。"));
  });
}
export const saveRecording = (recording: RecoveryRecording) => write("recordings", recording);
export const saveChunk = (recordingId: string, sequence: number, blob: Blob) => write("chunks", { recordingId, sequence, blob });
async function storedRecordings(uid: string): Promise<RecoveryRecording[]> {
  const db = await database();
  return new Promise((resolve, reject) => { const r = db.transaction("recordings").objectStore("recordings").getAll(); r.onsuccess = () => resolve((r.result as RecoveryRecording[]).filter((v) => v.uid === uid)); r.onerror = () => reject(new Error("保存済み録音を確認できません")); });
}
export async function recoveryRecordings(uid: string): Promise<RecoveryRecording[]> {
  const all = await storedRecordings(uid);
  const expired = all.filter(row => row.deleteAfter !== undefined && row.deleteAfter <= Date.now());
  for (const row of expired) await deleteRecovery(uid, row.id);
  return all.filter(row => row.deleteAfter === undefined || row.deleteAfter > Date.now());
}
export async function expireRoomRecordings(uid: string, roomId: string, deleteAfter: number) {
  for (const [id, held] of memory) if (held.recording.uid === uid && held.recording.roomId === roomId) {
    held.recording.deleteAfter = Math.min(held.recording.deleteAfter ?? Infinity, deleteAfter);
    if (deleteAfter <= Date.now()) memory.delete(id);
  }
  const records = await storedRecordings(uid);
  for (const row of records.filter(row => row.roomId === roomId)) {
    if (deleteAfter <= Date.now()) await deleteRecovery(uid, row.id);
    else await saveRecording({...row, deleteAfter: Math.min(row.deleteAfter ?? Infinity, deleteAfter)});
  }

}
export async function recoveryAudio(uid: string, id: string): Promise<Blob> {
  const pending = memory.get(id);
  if (pending?.recording.uid === uid) {
    if ((pending.recording.deleteAfter ?? Infinity) <= Date.now()) { memory.delete(id); throw new Error("録音の保存期限を過ぎました"); }
    return pending.blob;
  }
  const recordings = await recoveryRecordings(uid), recording = recordings.find((r) => r.id === id);
  if (!recording?.complete) throw new Error("途中で停止した録音は、再生できることを確認できません");
  return storedAudio(recording, false);
}
/** 端末に保存した区間を、MediaRecorder の開始からの順に復元する。partial なら、書きかけの区間も、続いて保存できたところまで返す */
async function storedAudio(recording: RecoveryRecording, partial: boolean): Promise<Blob> {
  const db = await database();
  const chunks = await new Promise<{ sequence: number; blob: Blob }[]>((resolve, reject) => {
    const r = db.transaction("chunks").objectStore("chunks").getAll(IDBKeyRange.bound([recording.id, 0], [recording.id, Number.MAX_SAFE_INTEGER]));
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error("音声を読み込めません"));
  });
  // 同じMediaRecorderの開始からstopまでを順番通り復元する。各timesliceが単体で再生可能とは仮定しない。
  if (!partial && (chunks.length !== recording.chunks || chunks.some((v, i) => v.sequence !== i))) throw new Error("録音の一部が見つかりません");
  const contiguous = chunks.sort((a, b) => a.sequence - b.sequence).filter((v, i) => v.sequence === i);
  return new Blob(contiguous.map((v) => v.blob), { type: recording.mimeType });
}
/** 区間の長さが分からない（書きかけの）ときの見積もり。MediaRecorder は15秒ごとに保存する */
const CHUNK_MS = 15_000;
export interface RoomSegment { id: string; blob: Blob; durationMs: number; createdAt: number }
/**
 * この部屋で、この端末に残っている録音の区間（古い順）。録音が途中で止まって続きを録った・画面を開き直したときに、
 * 区間が複数になる。書きかけのまま画面が閉じた区間も、保存できたところまで含める（読めない区間は API が除く）。
 */
export async function roomSegments(uid: string, roomId: string): Promise<RoomSegment[]> {
  const found = new Map<string, RoomSegment>();
  for (const { recording, blob } of unsavedAudio(uid)) if (recording.roomId === roomId && blob.size) found.set(recording.id, { id: recording.id, blob, durationMs: recording.durationMs ?? 0, createdAt: recording.createdAt });
  for (const r of (await recoveryRecordings(uid).catch(() => [] as RecoveryRecording[])).filter((r) => r.roomId === roomId && !found.has(r.id))) {
    const blob = await storedAudio(r, !r.complete).catch(() => null);
    if (blob?.size) found.set(r.id, { id: r.id, blob, durationMs: r.durationMs ?? r.chunks * CHUNK_MS, createdAt: r.createdAt });
  }
  return [...found.values()].sort((a, b) => a.createdAt - b.createdAt);
}
export function releaseUnsavedAudio(id: string) { memory.delete(id); }
export async function deleteRecovery(uid: string, id: string) {
  const held = memory.get(id);
  // 読取エラーを空と扱わず、期限切れも含めて所有権を確認する。
  const stored = await storedRecordings(uid);
  if (held?.recording.uid !== uid && !stored.some((r) => r.id === id)) throw new Error("この録音を削除できません");
  if (stored.some((r) => r.id === id)) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["recordings", "chunks"], "readwrite");
      tx.objectStore("recordings").delete(id);
      const cursor = tx.objectStore("chunks").openKeyCursor(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
      cursor.onsuccess = () => { const entry = cursor.result; if (entry) { tx.objectStore("chunks").delete(entry.primaryKey); entry.continue(); } };
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error("録音を削除できませんでした"));
    });
  }
  memory.delete(id);
}
