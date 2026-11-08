import type { Express } from 'express';
import { z } from 'zod';
import type { Dependencies } from './dependencies.js';
import { HttpError, parse, run, wrap, isExpired, type AuthRequest, type Handler } from './http.js';
import { createLimiter } from './limits.js';
import { googleWorkspace, type Workspace, type Course } from './workspace.js';
import { participantTitle } from './room-visibility.js';

const courseIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
/** Google本人をFirebaseの署名済み識別子と照合する。メール・表示名・クライアントの役割を信用しない。 */
export async function classroomIdentity(req: AuthRequest, workspace: Workspace) {
  const token = req.header('x-google-access-token');
  if (!token || token.length > 4096 || /\s/.test(token)) throw new HttpError(409, 'google_reconnect', 'Classroomとの連携を許可してください');
  const googleId = await workspace.identity(token);
  const identities = req.ctx.token?.firebase?.identities?.['google.com'];
  if (!Array.isArray(identities) || !identities.includes(googleId)) throw new HttpError(403, 'google_account_mismatch', 'ログイン中と同じGoogleアカウントを選んでください');
  return { token, googleId };
}
export async function classroomCourse(req: AuthRequest, workspace: Workspace, id: string) {
  parse(courseIdSchema, id);
  const identity = await classroomIdentity(req, workspace);
  const course = (await workspace.courses(identity.token)).find(c => c.id === id);
  if (!course) throw new HttpError(403, 'not_course_member', 'このクラスにはアクセスできません。所属とアカウントを確認してください');
  return { ...identity, course };
}
export function registerClassroomRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler; host: Handler }) {
  const workspace = deps.workspace ?? googleWorkspace(), { authenticate, member, host } = guards;
  const limit = createLimiter(deps.db, deps.now);
  const googleLimit = run(async req => { await limit(req.ctx.uid, 'workspace', 60); });
  app.get('/integrations/classroom/courses', authenticate, googleLimit, wrap(async (req, res) => {
    const { token } = await classroomIdentity(req, workspace);
    res.json({ courses: await workspace.courses(token), syncedAt: deps.now() });
  }));
  app.get('/integrations/classroom/courses/:courseId/roster', authenticate, googleLimit, wrap(async (req, res) => {
    const { course, token } = await classroomCourse(req, workspace, req.params.courseId);
    if (course.role !== 'teacher') throw new HttpError(403, 'course_teacher_required', '名簿はこのクラスの教員だけが確認できます');
    res.json({ students: await workspace.roster(token, course.id), syncedAt: deps.now() });
  }));
  app.get('/integrations/classroom/courses/:courseId/discussions', authenticate, googleLimit, wrap(async (req, res) => {
    const { course } = await classroomCourse(req, workspace, req.params.courseId);
    // 単一フィールド索引を使い、上限超過を空一覧として扱わない。追加の複合索引は不要。
    const docs = await deps.db.collection('sessions').where('classroomCourseId', '==', course.id).limit(101).get();
    if (docs.size > 100) throw new HttpError(413, 'too_many_discussions', 'このクラスの話し合いが多いため一覧を取得できません');
    const available = docs.docs.filter(d => !d.get('endedAt') && d.get('phase') !== 'closed' && !isExpired(d, deps.now()));
    const memberships = available.length ? await deps.db.getAll(...available.map(d => d.ref.collection('members').doc(req.ctx.uid))) : [];
    const sessions = available.flatMap((d, i) => {
      const m = memberships[i], joined = m.exists && m.get('status') === 'active';
      if ((m.exists && !joined) || (!joined && d.get('phase') !== 'collecting')) return [];
      const canViewTheme = m.get('role') === 'host' || d.get('participantView.theme') !== false;
      // 参加コード・名簿・分析を一覧へ流さない。参加操作では所属を再検証する。
      return [{ roomId: d.id, title: participantTitle({ title: d.get('title'), theme: d.get('theme'), themeHidden: !canViewTheme }), theme: canViewTheme ? d.get('theme') ?? '' : '', className: course.name, phase: d.get('phase'), joined, host: joined && m.get('role') === 'host' }];
    });
    res.json({ sessions, syncedAt: deps.now() });
  }));
  app.get('/rooms/:roomId/classroom/roster', authenticate, member, host, googleLimit, wrap(async (req, res) => {
    const room = await deps.db.doc(`sessions/${req.params.roomId}`).get();
    if (!room.get('classroomCourseId')) throw new HttpError(404, 'classroom_not_linked', 'この話し合いにはクラスが設定されていません');
    const { course, token } = await classroomCourse(req, workspace, room.get('classroomCourseId'));
    if (course.role !== 'teacher') throw new HttpError(403, 'course_teacher_required', 'このクラスの教員だけが確認できます');
    const roster = await workspace.roster(token, course.id);
    const members = await room.ref.collection('members').where('role', '==', 'participant').get();
    const joined = new Set(members.docs.filter(m => m.get('status') === 'active').map(m => m.get('classroomUserId')));
    const students = roster.map(p => ({ ...p, joined: joined.has(p.id) }));
    res.json({ course, students, syncedAt: deps.now(), sharedDeviceNote: '共有端末はログインしたアカウント単位の表示です。個人ごとの出席確認ではありません。' });
  }));
}
export function classroomFields(course: Course) {
  return { classroomCourseId: course.id, classroomCourseName: course.name, ...(course.section ? { classroomCourseSection: course.section } : {}), className: [course.name, course.section].filter(Boolean).join('・').slice(0, 40) };
}
