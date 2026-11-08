import type { Express, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { z } from 'zod';
import { HttpError, parse, run, wrap, type Handler, type AuthRequest } from './http.js';
import type { Dependencies } from './dependencies.js';
import { createSessions, hashSession, publicSession, requireFresh, sessionSecret, type Session } from './sessions.js';

const local = () => [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST].every((v) => /^(127\.0\.0\.1|localhost):\d+$/.test(v ?? ''));
export const cookieName = () => local() ? 'discuss_session_dev' : '__Host-discuss_session';
export function readSessionCookie(req: Request) {
  const values = (req.header('cookie') ?? '').split(';').map((s) => s.trim()).filter((s) => s.startsWith(`${cookieName()}=`));
  if (values.length !== 1) return '';
  return values[0].slice(cookieName().length + 1);
}
export function setSessionCookie(res: Response, secret: string, session: Session, now: number) {
  res.cookie(cookieName(), secret, { httpOnly: true, secure: !local(), sameSite: 'strict', path: '/', maxAge: Math.max(0, session.expiresAt.toMillis() - now) });
}
const clearCookie = (res: Response) => res.clearCookie(cookieName(), { httpOnly: true, secure: !local(), sameSite: 'strict', path: '/' });
const infoSchema = z.object({ deviceLabel: z.string().trim().min(1).max(40), deviceType: z.enum(['pc', 'tablet', 'phone', 'other']), isSharedDevice: z.boolean().default(false), classEndsAt: z.number().int().nullable().default(null) }).strict();
const sharedSchema = infoSchema.pick({ isSharedDevice: true, classEndsAt: true });

export function sessionGuards(deps: Dependencies) {
  const sessions = createSessions(deps.db, deps.now);
  async function identify(req: AuthRequest) {
    if (req.header('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'csrf_rejected', '同じ画面から操作してください');
    const token = req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'unauthenticated', 'ログインが必要です');
    let decoded: DecodedIdToken;
    try { decoded = await deps.auth.verifyIdToken(token, true); }
    catch { await sessions.failed('login_failed'); throw new HttpError(401, 'unauthenticated', 'IDトークンが無効です'); }
    if (decoded.firebase?.sign_in_provider !== 'google.com') { await sessions.failed('suspicious_auth'); throw new HttpError(403, 'google_login_required', 'Googleでログインしてください'); }
    req.ctx = { uid: decoded.uid, provider: 'google.com', token: decoded };
    return decoded;
  }
  const identity = run(async (req) => { await identify(req); });
  const authenticate = run(async (req, res) => {
    const token = await identify(req), secret = sessionSecret(readSessionCookie(req));
    const checked = await sessions.validate(token, secret);
    req.ctx.session = checked.session;
    // 明示的な成功操作だけを延長する。取得・進捗ポーリング・購読・トークン更新は除く。
    if (req.method === 'POST' && req.path.startsWith('/rooms') && !req.path.endsWith('/progress') && !req.path.includes('/speaker/') && !req.path.includes('/transcripts/') && !req.path.endsWith('/processing/run')) {
      res.locals.recordActivity = async () => {
        const active = await sessions.validate(token, secret, { activity: true });
        setSessionCookie(res, secret, active.session, deps.now());
      };
    }
  });
  return { sessions, identity, authenticate, identify };
}
export function registerSessionRoutes(app: Express, deps: Dependencies, guards: ReturnType<typeof sessionGuards>, limiter: (uid: string, action: 'create' | 'join' | 'submit' | 'session-login' | 'session-activity', limit: number, ms?: number) => Promise<void>) {
  const { sessions, identity } = guards;
  const cookie = (req: Request) => sessionSecret(readSessionCookie(req));
  const current = (allowLocked = false): Handler => run(async (req) => { await sessions.validate(req.ctx.token!, cookie(req), { allowLocked }); });
  const validEnd = (value: number | null) => {
    if (value !== null && (value <= deps.now() || value > deps.now() + 24 * 60 * 60_000)) throw new HttpError(400, 'bad_request', '授業終了は24時間以内の未来の時刻にしてください');
  };
  app.post('/sessions', identity, wrap(async (req, res) => {
    await limiter(req.ctx.uid, 'session-login', 20, 60 * 60_000);
    const info = parse(infoSchema, req.body); validEnd(info.classEndsAt);
    if (info.isSharedDevice && (await sessions.policy(req.ctx.token!)).endAtClassEnd && info.classEndsAt === null) throw new HttpError(400, 'class_end_required', '共用端末の授業終了時刻を指定してください');
    const created = await sessions.create(req.ctx.token!, info, readSessionCookie(req));
    setSessionCookie(res, created.secret, created.session, deps.now());
    res.status(201).json({ session: publicSession(created.session), policy: created.policy, serverNow: deps.now() });
  }));
  app.get('/sessions/current', identity, wrap(async (req, res) => {
    const checked = await sessions.validate(req.ctx.token!, cookie(req));
    res.json({ session: publicSession(checked.session), policy: checked.policy, serverNow: deps.now() });
  }));
  app.get('/sessions', identity, current(), wrap(async (req, res) => { res.json({ sessions: await sessions.list(req.ctx.token!), currentId: hashSession(cookie(req)) }); }));
  app.post('/sessions/activity', identity, wrap(async (req, res) => {
    await limiter(req.ctx.uid, 'session-activity', 120);
    const checked = await sessions.validate(req.ctx.token!, cookie(req), { activity: true });
    setSessionCookie(res, cookie(req), checked.session, deps.now());
    res.json({ session: publicSession(checked.session), policy: checked.policy, serverNow: deps.now() });
  }));
  app.post('/sessions/unlock', identity, wrap(async (req, res) => {
    await limiter(req.ctx.uid, 'session-login', 20, 60 * 60_000);
    const old = await sessions.validate(req.ctx.token!, cookie(req), { allowLocked: true });
    requireFresh(req.ctx.token!, deps.now(), Math.floor((old.session.lockedAt?.toMillis() ?? deps.now()) / 1000) * 1000);
    const created = await sessions.create(req.ctx.token!, { deviceLabel: old.session.deviceLabel, deviceType: old.session.deviceType, isSharedDevice: old.session.isSharedDevice, classEndsAt: old.session.classEndsAt?.toMillis() ?? null }, cookie(req));
    setSessionCookie(res, created.secret, created.session, deps.now());
    res.json({ session: publicSession(created.session), policy: created.policy, serverNow: deps.now() });
  }));
  app.post('/sessions/revoke', identity, current(), wrap(async (req, res) => {
    const { sessionId } = parse(z.object({ sessionId: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), req.body);
    await sessions.revokeMany(req.ctx.token!, sessionId, 'logout');
    if (sessionId === hashSession(cookie(req))) clearCookie(res);
    res.json({ ok: true });
  }));
  app.post('/sessions/logout', identity, current(true), wrap(async (req, res) => {
    await sessions.revokeMany(req.ctx.token!, hashSession(cookie(req)), 'logout'); clearCookie(res); res.json({ ok: true });
  }));
  app.post('/sessions/logout-all', identity, current(true), wrap(async (req, res) => {
    await sessions.revokeMany(req.ctx.token!, undefined, 'logout_all'); clearCookie(res); res.json({ ok: true });
  }));
  app.post('/sessions/shared-device', identity, current(), wrap(async (req, res) => {
    const info = parse(sharedSchema, req.body); validEnd(info.classEndsAt);
    if (info.isSharedDevice && (await sessions.policy(req.ctx.token!)).endAtClassEnd && info.classEndsAt === null) throw new HttpError(400, 'class_end_required', '共用端末の授業終了時刻を指定してください');
    await sessions.setShared(req.ctx.token!, cookie(req), info); res.json({ ok: true });
  }));
}
