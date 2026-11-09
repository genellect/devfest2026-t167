import { HttpError } from './http.js';
import type { Workspace } from './workspace.js';
/** server.ts が両エミュレータ＋明示フラグの場合だけ注入する。実Googleへ通信しない。 */
export const classroomMock: Workspace = {
  async identity(token) { if (!token.startsWith('classroom-mock:') || token.length <= 15) throw new HttpError(409, 'google_reconnect', '模擬連携をやり直してください'); return token.slice(15); },
  async courses(token) { const id = await this.identity(token); return [{ id: 'mock-class-1', name: 'サンプル 探究学習', section: '1年1組', role: id === 'local-teacher' || id.startsWith('classroom-test-teacher-') ? 'teacher' : 'student' }]; },
  async roster() { return [{ id: 'local-student', name: 'サンプル生徒' }, { id: 'classroom-not-joined', name: '未参加のサンプル生徒' }]; },
};
