import { expect, it } from 'vitest';
import { emulatorProxy } from './emulator-proxy';
it('iPadのHTTPSでは認証とFirestoreを同一オリジンへ向ける', () => {
  expect(emulatorProxy('https://192.168.1.20:13443', true)).toEqual({ authUrl: 'https://192.168.1.20:13443', firestore: { host: '192.168.1.20:13443', ssl: true, experimentalForceLongPolling: true } });
});
it('通常起動・HTTP・ブラウザ初期化前には既存の接続を維持する', () => {
  expect(emulatorProxy('https://192.168.1.20:13443', false)).toBeUndefined();
  expect(emulatorProxy('http://localhost:13000', true)).toBeUndefined();
  expect(emulatorProxy(undefined, true)).toBeUndefined();
});
