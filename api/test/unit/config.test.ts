import { describe, expect, it } from 'vitest';
import { describeGemini, readConfig } from '../../src/config.js';

const prod = { GOOGLE_CLOUD_PROJECT: 'p', VERTEX_LOCATION: 'global', GEMINI_MODEL: 'm', GEMINI_MOCK: '0' };

describe('起動時の環境変数', () => {
  it('本番の値がそろえば、Vertex AI のプロジェクトは Firestore と同じ', () => {
    expect(readConfig(prod)).toEqual({ project: 'p', gemini: { mock: false, project: 'p', location: 'global', model: 'm' } });
  });
  it('VERTEX_PROJECT で Vertex AI のプロジェクトだけを分けられる（手元の GEMINI_MOCK=0）', () => {
    const c = readConfig({ ...prod, GOOGLE_CLOUD_PROJECT: 'demo-t167', VERTEX_PROJECT: 'real' });
    expect(c.project).toBe('demo-t167');
    expect(c.gemini).toMatchObject({ mock: false, project: 'real' });
  });
  it('接続先とモデルに既定値はなく、未設定・空文字・空白・雛形の文字列は止まる', () => {
    for (const bad of [undefined, '', '  ', 'ここに決めたモデルID']) {
      expect(() => readConfig({ ...prod, VERTEX_LOCATION: bad })).toThrow(/VERTEX_LOCATION/);
      expect(() => readConfig({ ...prod, GEMINI_MODEL: bad })).toThrow(/GEMINI_MODEL/);
    }
  });
  it('足りない値はまとめて伝える', () => {
    expect(() => readConfig({ GEMINI_MOCK: '0' })).toThrow('GOOGLE_CLOUD_PROJECT・VERTEX_LOCATION・GEMINI_MODEL');
  });
  it('モックでは接続先もモデルも要らない', () => {
    expect(readConfig({ GOOGLE_CLOUD_PROJECT: 'demo-t167', GEMINI_MOCK: '1' }).gemini).toEqual({ mock: true, fail: false });
    expect(readConfig({ GOOGLE_CLOUD_PROJECT: 'demo-t167', GEMINI_MOCK: '1', GEMINI_MOCK_FAIL: '1' }).gemini).toEqual({ mock: true, fail: true });
  });
  it('起動ログに接続先とモデルを出す', () => {
    expect(describeGemini(readConfig(prod).gemini)).toBe('m @ global（p）');
    expect(describeGemini({ mock: true, fail: false })).toBe('mock');
  });
});
