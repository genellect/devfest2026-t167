import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { HIDDEN_THEME_TITLE, isThemeCopiedIntoTitle, participantTitle, titleRevealsTheme, recordingAnalysisTheme } from '../../src/room-visibility.js';
import { registerDiscussionRoutes } from '../../src/discussion-routes.js';
import type { Dependencies } from '../../src/dependencies.js';
import type { Handler } from '../../src/http.js';

const SECRET = '架空の非公開テーマ';

describe('テーマ非公開時の参加者向けの名前（R1）', () => {
  it('テーマと重なる名前だけを伏せ、公開中・別の名前はそのまま返す', () => {
    expect(participantTitle({ title: SECRET, theme: SECRET, themeHidden: true })).toBe(HIDDEN_THEME_TITLE);
    expect(participantTitle({ title: 'A'.repeat(100), theme: 'A'.repeat(300), themeHidden: true })).toBe(HIDDEN_THEME_TITLE);
    expect(participantTitle({ title: '架空の授業 第2回', theme: SECRET, themeHidden: true })).toBe('架空の授業 第2回');
    expect(participantTitle({ title: SECRET, theme: SECRET, themeHidden: false })).toBe(SECRET);
    expect(participantTitle({ title: '名前', theme: '', themeHidden: true })).toBe('名前');
    expect(titleRevealsTheme('', SECRET)).toBe(false);
    expect(titleRevealsTheme(undefined, SECRET)).toBe(false);
  });
  it('古い画面の「title = テーマの先頭100文字」の保存だけを判定する', () => {
    expect(isThemeCopiedIntoTitle({ title: SECRET, theme: SECRET }, '架空の授業')).toBe(true);
    expect(isThemeCopiedIntoTitle({ title: 'B'.repeat(100), theme: 'B'.repeat(200) }, '架空の授業')).toBe(true);
    expect(isThemeCopiedIntoTitle({ title: '架空の授業', theme: '' }, '架空の授業')).toBe(false);
    expect(isThemeCopiedIntoTitle({ theme: SECRET }, '架空の授業')).toBe(false);
    expect(isThemeCopiedIntoTitle({ title: '別の名前' }, '架空の授業')).toBe(false);
  });
  // レビュー資料 review-theme-privacy.test.ts の再現例（DB と認証は架空の stub）
  it('テーマ非公開時は設定保存で転記されたテーマを参加者の一覧にも返さない', async () => {
    const room = { exists: true, id: 'test-room', get: (key: string) => ({ title: SECRET, theme: SECRET, 'participantView.theme': false, phase: 'discussing' } as Record<string, unknown>)[key] };
    const member = { exists: true, get: (key: string) => ({ role: 'participant', status: 'active', groupId: '1' } as Record<string, unknown>)[key], ref: { parent: { parent: 'room-ref' } } };
    let gets = 0;
    const db = { collection: () => ({ get: async () => ({ empty: false, docs: [{ id: 'test-room' }] }) }), doc: () => 'member-ref', getAll: async () => ++gets === 1 ? [member] : [room] };
    const guard: Handler = (req, _res, next) => { req.ctx = { uid: 'participant', role: 'participant' } as typeof req.ctx; next(); };
    const app = express(); registerDiscussionRoutes(app, { db } as unknown as Dependencies, { authenticate: guard, member: guard, host: guard });
    const response = await request(app).get('/discussions').expect(200);
    expect(response.body.sessions[0]).toMatchObject({ theme: '', title: HIDDEN_THEME_TITLE });
    expect(JSON.stringify(response.body)).not.toContain(SECRET);
  });
});

describe('recordingAnalysisTheme', () => {
  const room = (data: Record<string, unknown>) => ({ get: (field: string) => field.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], data) });
  it('公開中はテーマ、テーマがなければ名前を渡す', () => {
    expect(recordingAnalysisTheme(room({ title: '名前', theme: 'テーマ本文' }))).toBe('テーマ本文');
    expect(recordingAnalysisTheme(room({ title: '名前', theme: '' }))).toBe('名前');
  });
  it('非公開のあいだは、テーマと重ならない名前だけを渡す', () => {
    expect(recordingAnalysisTheme(room({ title: '名前', theme: 'テーマ本文', participantView: { theme: false } }))).toBe('名前');
    expect(recordingAnalysisTheme(room({ title: 'テーマ本', theme: 'テーマ本文', participantView: { theme: false } }))).toBe('話し合い');
  });
});
