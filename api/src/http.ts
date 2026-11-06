import type { NextFunction, Request, Response } from 'express';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Session } from './sessions.js';

export interface Context { uid: string; provider: string; role?: 'host' | 'participant'; token?: DecodedIdToken; session?: Session }
export type AuthRequest = Request & { ctx: Context };
export type Handler = (req: Request, res: Response, next: NextFunction) => void;
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: object = {}) { super(message); }
}
export const wrap = (fn: (req: AuthRequest, res: Response) => Promise<unknown>): Handler =>
  (req, res, next) => {
    if (!res.locals?.recordActivity) { fn(req as AuthRequest, res).catch(next); return; }
    // 成功した業務操作だけをサーバー時刻で記録してからJSONを返す。
    const send = res.json.bind(res);
    let body: unknown, pending = false;
    res.json = (value: unknown) => { body = value; pending = true; return res; };
    fn(req as AuthRequest, res).then(async () => {
      res.json = send;
      if (pending) { await res.locals.recordActivity?.(); send(body); }
    }).catch((error: unknown) => { res.json = send; next(error); });
  };
export const run = (fn: (req: AuthRequest, res: Response) => Promise<void>): Handler =>
  (req, res, next) => { fn(req as AuthRequest, res).then(() => { if (!res.headersSent) next(); }).catch(next); };
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  // Zod の詳細に入力値が含まれる可能性があるため、固定文言だけを返す。
  if (!result.success) throw new HttpError(400, 'bad_request', '入力内容を確認してください');
  return result.data;
}
/** 作成から時間がたって失効したセッション（expiresAt は作成時に API が書く） */
export function isExpired(room: DocumentSnapshot, now = Date.now()) {
  const expiresAt = room.get('expiresAt');
  return typeof expiresAt?.toMillis === 'function' && expiresAt.toMillis() <= now;
}
export function requireOpenRoom(room: DocumentSnapshot) {
  if (!room.exists) throw new HttpError(404, 'room_not_found', '部屋がありません');
  if (room.get('phase') === 'closed') throw new HttpError(409, 'room_closed', 'この部屋は終了しています');
  if (isExpired(room)) throw new HttpError(409, 'room_expired', 'このセッションは終了しました');
}

/** ディスカッションを作れるのは、管理者が招待した教員（Google アカウントの teacher claim）だけ */
export function requireTeacher(context: Pick<Context, 'token'>): void {
  if (context.token?.teacher !== true) throw new HttpError(403, 'teacher_required', 'ディスカッションを作れるのは、招待された教員のアカウントだけです');
}
export function requireModerator(context: Pick<Context, 'role'>): void {
  if (context.role !== 'host') throw new HttpError(403, 'not_moderator', 'このセッションのHostだけが実行できます');
}
