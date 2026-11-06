/** iPadのlocalhostへ接続しないよう、HTTPSプレビューの同一オリジンへまとめる。通常のローカル起動は維持する。 */
export function emulatorProxy(origin: string | undefined, enabled: boolean) {
  if (!enabled || !origin) return undefined;
  const url = new URL(origin);
  if (url.protocol !== 'https:') return undefined;
  return {
    authUrl: url.origin,
    firestore: { host: url.host, ssl: true, experimentalForceLongPolling: true },
  };
}
