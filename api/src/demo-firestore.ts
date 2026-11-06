import type { Firestore } from 'firebase-admin/firestore';
/** デモの全データを専用ルートへ隔離する。権限境界は通常のAPI認可を維持する。 */
export function demoFirestore(db: Firestore, demoId?: string): Firestore {
  if (!demoId) return db;
  if (!/^pr[0-9]+(?:-[a-z0-9]+)?$/.test(demoId)) throw new Error('DEMO_IDはpr番号で指定してください');
  const prefix = `demoEnvironments/${demoId}/`;
  return new Proxy(db, { get(target, property) {
    if (property === 'doc') return (path: string) => target.doc(prefix + path);
    if (property === 'collection') return (path: string) => target.collection(prefix + path);
    if (property === 'collectionGroup') return () => { throw new Error('デモでは全環境のcollectionGroup検索を禁止します'); };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
