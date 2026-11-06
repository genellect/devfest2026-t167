"use client";

/** 16kHz mono PCM16への変換。登録用音声だけを扱い、長いファイルはデコード前に拒否する。 */
export async function voicePcm(blob: Blob): Promise<ArrayBuffer> {
  if (blob.size > 1024 * 1024) throw new Error('登録する音声は1MB以内にしてください');
  const context = new AudioContext();
  let buffer: AudioBuffer;
  try { buffer = await context.decodeAudioData(await blob.arrayBuffer()); } finally { await context.close(); }
  if (buffer.duration < 8 || buffer.duration > 12) throw new Error('8〜12秒、1人だけが話す音声を登録してください');
  const offline = new OfflineAudioContext(1, Math.round(buffer.duration * 16000), 16000);
  const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
  const samples = (await offline.startRendering()).getChannelData(0), pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
  samples.fill(0);
  return pcm.buffer;
}

export async function recordVoice(signal: AbortSignal, progress: (seconds: number) => void): Promise<Blob> {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('マイクを使えるHTTPS対応ブラウザで開いてください');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (signal.aborted) { stream.getTracks().forEach((t) => t.stop()); throw new Error('音声登録を中断しました'); }
  return new Promise((resolve, reject) => {
    const recorder = new MediaRecorder(stream), parts: Blob[] = [], started = Date.now();
    const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    const timer = setTimeout(stop, 9000), clock = setInterval(() => progress(Math.min(9, Math.floor((Date.now() - started) / 1000))), 200);
    const cleanup = () => { clearTimeout(timer); clearInterval(clock); stream.getTracks().forEach((t) => t.stop()); signal.removeEventListener('abort', stop); };
    signal.addEventListener('abort', stop, { once: true });
    recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
    recorder.onerror = () => { cleanup(); reject(new Error('マイクから録音できませんでした')); };
    recorder.onstop = () => { cleanup(); if (signal.aborted) reject(new Error('音声登録を中断しました')); else resolve(new Blob(parts, { type: recorder.mimeType })); };
    recorder.start();
  });
}

export interface DraftRecording { key: string; blob: Blob; seconds: number; runId: string }
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('t167-mvp-recordings', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('端末への録音保存を利用できません'));
  });
}
export async function saveDraft(draft: DraftRecording) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(draft); tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('録音を端末に保存できません。ダウンロードして保管してください')); tx.onabort = tx.onerror; }); }
  finally { db.close(); }
}
export async function loadDraft(key: string): Promise<DraftRecording | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const req = db.transaction('drafts').objectStore('drafts').get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('端末の録音を読み込めません')); }); }
  finally { db.close(); }
}
export async function removeDraft(key: string) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('送信済み録音の端末保存を削除できません')); }); }
  finally { db.close(); }
}
