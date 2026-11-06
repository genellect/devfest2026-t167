import { expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { demoFirestore } from '../../src/demo-firestore.js';
it('通常DBを維持し、デモの文書・コレクションを専用ルートに固定する', () => {
  const db = { doc: vi.fn((v) => v), collection: vi.fn((v) => v), getAll() { return this; } } as unknown as Firestore;
  expect(demoFirestore(db)).toBe(db);
  const scoped = demoFirestore(db, 'pr34');
  expect(scoped.doc('users/u')).toBe('demoEnvironments/pr34/users/u');
  expect(scoped.collection('sessions')).toBe('demoEnvironments/pr34/sessions');
  expect(scoped.getAll()).toBe(db);
  expect(() => scoped.collectionGroup('members')).toThrow();
  expect(() => demoFirestore(db, '../production')).toThrow();
});
