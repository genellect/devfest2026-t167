import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upstreamFor } from '../scripts/ipad-proxy.mjs';
const ports = { web: 13000, auth: 19099, firestore: 18080 };
test('画面/API・認証・Firestoreの行き先を分ける', () => {
  assert.equal(upstreamFor('/rooms/r1', 'GET', ports), 13000);
  assert.equal(upstreamFor('/api/rooms/join', 'POST', ports), 13000);
  assert.equal(upstreamFor('/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake', 'POST', ports), 19099);
  assert.equal(upstreamFor('/securetoken.googleapis.com/v1/token?key=fake', 'POST', ports), 19099);
  assert.equal(upstreamFor('/google.firestore.v1.Firestore/Listen/channel?VER=8', 'POST', ports), 18080);
  assert.equal(upstreamFor('/google.firestore.v1.Firestore/Write/channel', 'GET', ports), 18080);
});
test('任意URL転送・管理API・未使用メソッドを公開しない', () => {
  for (const path of ['https://example.com', '//example.com', '/emulator/v1/projects/demo/accounts', '/identitytoolkit.googleapis.com/v1/projects/demo/accounts', '/v1/projects/demo/databases/(default)/documents']) {
    assert.equal(upstreamFor(path, 'GET', ports), undefined);
  }
  assert.equal(upstreamFor('/', 'CONNECT', ports), undefined);
});
