// ローカルの画面・API・Auth・Firestoreを同一HTTPSオリジンでiPadへ提供する。
import { createServer as httpServer, request } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { forward, forwardUpgrade, upstreamFor } from './ipad-proxy.mjs';

const ip = process.env.T167_IPAD_HOST ?? networkInterfaces().en0?.find(value => value.family === 'IPv4' && !value.internal)?.address;
if (!ip || isIP(ip) !== 4 || !Object.values(networkInterfaces()).flat().some(value => value?.address === ip)) throw new Error('このMacのWi-FiアドレスをT167_IPAD_HOSTに指定してください');
const offset = Number(process.env.T167_TEST_PORT_OFFSET ?? 0);
const ports = { web: Number(process.env.T167_WEB_PORT ?? 3000), auth: Number(process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT ?? 9099), firestore: Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? 8080) };
const tlsPort = Number(process.env.T167_IPAD_HTTPS_PORT ?? 3443 + offset), setupPort = Number(process.env.T167_IPAD_SETUP_PORT ?? 3080 + offset);
for (const port of [...Object.values(ports), tlsPort, setupPort]) if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ポートの設定を確認してください');
if (new Set([tlsPort, setupPort, ...Object.values(ports)]).size !== 5) throw new Error('ポートが重複しています');
process.umask(0o077);
const directory = mkdtempSync(join(tmpdir(), 'discuss-ipad-preview-'));
const file = name => join(directory, name);
const openssl = args => execFileSync('openssl', args, { stdio: 'ignore' });
const old = join(tmpdir(), 'discuss-recording-preview-cert');
let ca = file('ca.crt'), caKey = file('ca.key'), reusedCA = false;
if (existsSync(join(old, 'ca.crt')) && existsSync(join(old, 'ca.key'))) {
  try { openssl(['x509', '-checkend', '86400', '-noout', '-in', join(old, 'ca.crt')]); ca = join(old, 'ca.crt'); caKey = join(old, 'ca.key'); reusedCA = true; } catch { /* 期限が短ければ新しい検証用CAを作る */ }
}
if (!reusedCA) {
  writeFileSync(file('ca.cnf'), '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=Discuss Local Preview CA\n[ca]\nbasicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '7', '-config', file('ca.cnf'), '-keyout', caKey, '-out', ca]);
}
openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', file('server.key'), '-out', file('server.csr')]);
writeFileSync(file('server.ext'), `basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:${ip}\n`);
openssl(['x509', '-req', '-in', file('server.csr'), '-CA', ca, '-CAkey', caKey, '-CAserial', file('ca.serial'), '-CAcreateserial', '-days', '2', '-sha256', '-extfile', file('server.ext'), '-out', file('server.crt')]);
const url = `https://${ip}:${tlsPort}`, setupUrl = `http://${ip}:${setupPort}`;
function certificate(response, method) {
  response.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename=discuss-local-ca.crt', 'Cache-Control': 'no-store' });
  response.end(method === 'HEAD' ? undefined : readFileSync(ca));
}
const setup = httpServer((incoming, response) => {
  if (!['GET', 'HEAD'].includes(incoming.method)) { response.writeHead(405); response.end(); return; }
  if (incoming.url === '/local-ca.crt') { certificate(response, incoming.method); return; }
  if (incoming.url !== '/') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(incoming.method === 'HEAD' ? undefined : `<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Discuss iPad確認</title><body style="font:17px/1.8 system-ui;background:#f8fafd;color:#202124;max-width:760px;padding:24px;margin:auto"><h1>iPadでDiscussを確認</h1><p>Macと同じWi-FiのSafariで開いてください。現在はテスト用Google認証とテスト用DBです。AIの接続設定：${process.env.T167_IPAD_MODE === 'vertex' ? '実Gemini（生成成功は別途確認）' : 'モック'}。</p><ol><li><a href="${url}">確認画面を開く</a>。以前の録音プレビューの証明書を信頼済みなら、そのまま使用できます。</li><li>証明書が未設定の場合は<a href="/local-ca.crt">検証用証明書を取得</a>し、「設定」→「一般」→「VPNとデバイス管理」でインストールします。</li><li>「設定」→「一般」→「情報」→「証明書信頼設定」で、この検証用証明書を信頼します。</li><li>Safariに戻り、確認画面の「テスト用の先生」または「テスト用の生徒」でログインします。参加コードDEMO01を使用できます。</li></ol><p><a href="${url}/api/health">APIの接続状態を確認</a>。テスト用データだけを使用してください。検証後は追加したプロファイルを削除できます。学校の管理端末で証明書を追加できない場合は管理者に確認してください。</p></body></html>`);
});
const secure = httpsServer({ key: readFileSync(file('server.key')), cert: readFileSync(file('server.crt')) }, (incoming, response) => {
  forward(incoming, response, upstreamFor(incoming.url ?? '/', incoming.method ?? 'GET', ports));
});
secure.on('upgrade', (incoming, socket, head) => forwardUpgrade(incoming, socket, head, ports.web));
const sockets = new Set();
for (const server of [secure, setup]) server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
const close = () => { for (const socket of sockets) socket.destroy(); secure.close(); setup.close(); };
for (const server of [secure, setup]) server.on('error', () => { console.error('iPad用ポートを開始できません。別のポートを指定してください'); close(); process.exitCode = 1; });
process.on('SIGINT', close); process.on('SIGTERM', close);
try {
  await Promise.all([new Promise((resolve, reject) => { secure.once('error', reject); secure.listen(tlsPort, ip, resolve); }), new Promise((resolve, reject) => { setup.once('error', reject); setup.listen(setupPort, ip, resolve); })]);
} catch { close(); process.exit(1); }
mkdirSync('.local-data', { recursive: true });
writeFileSync('.local-data/ipad-preview.json', JSON.stringify({ url, setupUrl, ports, tlsPort, setupPort, ca, reusedCA, directory, pid: process.pid }, null, 2));
console.log(`iPad確認: ${url}\n初回設定: ${setupUrl}`);
