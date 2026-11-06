"use client";
import { firebase } from './firebase';

export interface MvpAttendee { id: string; name: string; registered: boolean }
export interface MvpResult {
  group: number; source: 'gemini' | 'mock'; speechDetected: boolean; flowNote: string; totalMinutes: number;
  segments: { topic: string; minutes: number }[];
  good: { at: string; text: string }[]; review: { at: string; text: string; question?: string }[];
  teacherSuggestions: string[];
}
export interface MvpState {
  id: string; role: 'host' | 'guest'; title: string; theme: string | null;
  phase: 'waiting' | 'discussing' | 'ended'; endsAt: number | null; endReason: string | null;
  minutes?: number; groups: number; code?: string; recording: boolean; published: boolean; publishOnEnd?: boolean;
  visible: { theme: boolean; members: boolean; timer: boolean };
  own: { group: number | null; mode: string | null; attendees: MvpAttendee[]; ready: boolean };
  members: { uid?: string; group: number; attendees: MvpAttendee[]; ready: boolean }[];
  results: MvpResult[]; jobs: { group: number; status: string }[]; source: string; voiceSource: string;
}

export async function mvpApi<T>(path: string, body?: object | Blob | ArrayBuffer, signal?: AbortSignal): Promise<T> {
  const auth = firebase().auth;
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error('Googleでログインしてください');
  const raw = body instanceof Blob || body instanceof ArrayBuffer;
  const response = await fetch(`/api/discussions${path}`, {
    method: body === undefined ? 'GET' : 'POST', signal, cache: 'no-store',
    headers: { authorization: `Bearer ${await user.getIdToken()}`, ...(body === undefined ? {} : { 'content-type': body instanceof Blob ? body.type : raw ? 'audio/pcm' : 'application/json' }) },
    body: body === undefined ? undefined : raw ? body as BodyInit : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error?.message ?? '接続に失敗しました。再試行してください');
  return value as T;
}

export const normalizeMvpCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
