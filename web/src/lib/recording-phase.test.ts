import { describe, expect, it } from 'vitest';
import { recordingPhase } from './recording-phase';
describe('MVPの録音終了', () => {
  it('グループの集計が遅れてもHostの議論中は録音を継続する', () => {
    expect(recordingPhase({ flowVersion: 1, phase: 'discussing' }, 1, 'opinions', false)).toBe(true);
    expect(recordingPhase({ flowVersion: 1, phase: 'discussing' }, 1, 'done', true)).toBe(true);
  });
  it('開始前・未所属・Host終了では録音を継続しない', () => {
    expect(recordingPhase({ flowVersion: 1, phase: 'collecting' }, 1, 'discussing', false)).toBe(false);
    expect(recordingPhase({ flowVersion: 1, phase: 'discussing' }, undefined, 'discussing', false)).toBe(false);
    expect(recordingPhase({ flowVersion: 1, phase: 'consensus' }, 1, 'discussing', false)).toBe(false);
  });
  it('従来のグループ別進行ではそのグループの終了を守る', () => {
    expect(recordingPhase({ phase: 'collecting' }, 1, 'discussing', false)).toBe(true);
    expect(recordingPhase({ phase: 'discussing' }, 1, 'consensus', false)).toBe(false);
  });
});
