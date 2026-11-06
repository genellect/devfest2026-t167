import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Gemini } from './gemini.js';
export interface OperationEvent { requestId: string; route: string; status: number; durationMs: number; code?: string }
export interface JobEvent { jobId: string; stage: 'points' | 'consensus' | 'group' | 'recording'; status: 'started' | 'completed' | 'failed'; durationMs: number }
export type AppEvent = OperationEvent | JobEvent;
export interface VoiceProvider { version: string; source: 'model' | 'mock'; extract(pcm: Buffer): Promise<{ embedding: number[] | null; speechMs: number; segments?: { startMs: number; endMs: number }[] }> }
export interface Dependencies { voice?: VoiceProvider; db: Firestore; auth: Auth; gemini: Gemini; now: () => number; observe?: (event: AppEvent) => void }
