import { describe, expect, it } from 'vitest';
import { acceptSpeech } from '../../src/speech-bucket.js';

// 各自端末：同じ秒を2台が聞いたときの発言時間の集計
describe('各自端末の同じ秒の集計', () => {
  it('同じ話者は大きい方だけを数える', () => {
    const a = acceptSpeech(undefined, 'u1', 800);
    expect(a).toMatchObject({ talk: { u1: 800 }, unknown: 0 });
    const b = acceptSpeech(a.bucket, 'u1', 900);
    expect(b).toMatchObject({ talk: { u1: 100 }, unknown: 0 });
    expect(acceptSpeech(b.bucket, 'u1', 500)).toMatchObject({ talk: {}, unknown: 0 });
  });
  it('近い端末が話者を特定した秒は、遠い端末の「話者不明」を追加で数えない', () => {
    const near = acceptSpeech(undefined, 'u1', 900);
    const far = acceptSpeech(near.bucket, null, 700);
    expect(far).toMatchObject({ talk: {}, unknown: 0 });
    // 不明のほうが長いときは、超えた分だけ数える
    expect(acceptSpeech(near.bucket, null, 1000)).toMatchObject({ talk: {}, unknown: 100 });
  });
  it('先に「話者不明」で数えた秒を後から特定できたら、不明の分を話者へ移す', () => {
    const far = acceptSpeech(undefined, null, 700);
    expect(far).toMatchObject({ unknown: 700 });
    const near = acceptSpeech(far.bucket, 'u1', 900);
    expect(near).toMatchObject({ talk: { u1: 900 }, unknown: -700 });
    expect(near.bucket).toEqual({ known: { u1: 900 }, unknown: 0 });
  });
  it('同じ秒に別々の話者が話した場合は、それぞれ数える', () => {
    const a = acceptSpeech(undefined, 'u1', 600);
    expect(acceptSpeech(a.bucket, 'u2', 500)).toMatchObject({ talk: { u2: 500 }, unknown: 0 });
  });
  it('範囲外の値を0〜1000msに収める', () => {
    expect(acceptSpeech(undefined, 'u1', 5000).talk).toEqual({ u1: 1000 });
    expect(acceptSpeech(undefined, null, -10)).toMatchObject({ unknown: 0 });
  });
});
