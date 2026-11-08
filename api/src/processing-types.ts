export interface SpeechSegment { startMs: number; endMs: number; text: string }
export interface Evidence { id: string; text: string }
export interface EvidenceReview { observations: { evidenceId: string; text: string }[]; nextSteps: { evidenceId: string; text: string }[] }
export const RETENTION = Object.freeze({ discussionMs: 30 * 86400000, voiceMs: 90 * 86400000, uploadMs: 5 * 60000, jobLeaseMs: 60000, maxAttempts: 3 });
