import test from 'node:test';
import assert from 'node:assert/strict';
import {upstreamFor} from '../scripts/ipad-proxy.mjs';
const ports={web:38002,auth:44099,firestore:43080};
test('HTTPSのFirebase認証・iframe relay・Firestoreを固定した内部サービスへ転送する',()=>{
 for(const path of ['/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key','/securetoken.googleapis.com/v1/token?key=demo-key','/emulator/auth/handler?apiKey=demo-key','/emulator/auth/iframe?apiKey=demo-key'])assert.equal(upstreamFor(path,'GET',ports),ports.auth);
 for(const method of ['Listen','Write'])assert.equal(upstreamFor(`/google.firestore.v1.Firestore/${method}/channel?VER=8`,'POST',ports),ports.firestore);
 assert.equal(upstreamFor('/api/health','GET',ports),ports.web);
});
test('エミュレータ管理APIと任意URLをHTTPS入口へ公開しない',()=>{
 for(const path of ['/emulator/v1/projects/demo-t167/accounts','/identitytoolkit.googleapis.com/v1/projects/demo-t167/accounts','/v1/projects/demo-t167/databases/(default)/documents','//example.com','https://example.com','/google.firestore.v1.Firestore/Other/channel'])for(const method of ['GET','POST','DELETE'])assert.equal(upstreamFor(path,method,ports),undefined);
 assert.equal(upstreamFor('/api/health','CONNECT',ports),undefined);
});
