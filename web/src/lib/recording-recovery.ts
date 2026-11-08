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
  const db = await database();
  const chunks = await new Promise<{ sequence: number; blob: Blob }[]>((resolve, reject) => {
    const r = db.transaction("chunks").objectStore("chunks").getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error("音声を読み込めません"));
  });
  if (chunks.length !== recording.chunks || chunks.some((v, i) => v.sequence !== i)) throw new Error("録音の一部が見つかりません");
  // 同じMediaRecorderの開始からstopまでを順番通り復元する。各timesliceが単体で再生可能とは仮定しない。
  return new Blob(chunks.map((v) => v.blob), { type: recording.mimeType });
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
