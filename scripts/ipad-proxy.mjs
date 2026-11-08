import { request } from 'node:http';
/** 入口ごとに上流を固定し、任意のURLやエミュレータの管理APIを公開しない。 */
export function upstreamFor(path, method, ports) {
  if (!path.startsWith('/') || path.startsWith('//')) return undefined;
  if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(method)) return undefined;
  if (/^\/(identitytoolkit\.googleapis\.com\/v1\/accounts:[A-Za-z]+|securetoken\.googleapis\.com\/v1\/token)(?:\?|$)/.test(path)) return ports.auth;
  if (/^\/emulator\/auth\/(?:handler|iframe)(?:[/?]|$)/.test(path)) return ports.auth;
  if (/^\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel(?:\?|$)/.test(path)) return ports.firestore;
  if (/^\/(identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|emulator|v1\/projects|google\.firestore)/.test(path)) return undefined;
  return ports.web;
}
export function forward(incoming, outgoing, port) {
  if (!port) { outgoing.writeHead(404); outgoing.end(); return; }
  const upstream = request({ hostname: '127.0.0.1', port, path: incoming.url, method: incoming.method,
    headers: { ...incoming.headers, 'x-forwarded-proto': 'https' } }, response => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
  });
  upstream.setTimeout(300_000, () => upstream.destroy());
  upstream.on('error', () => { if (outgoing.headersSent) outgoing.destroy(); else { outgoing.writeHead(502); outgoing.end('Macのプレビューサーバーへの接続を確認してください'); } });
  incoming.on('aborted', () => upstream.destroy());
  outgoing.on('close', () => { if (!outgoing.writableEnded) upstream.destroy(); });
  incoming.pipe(upstream);
}
export function forwardUpgrade(incoming, socket, head, port) {
  if (!incoming.url?.startsWith('/_next/')) { socket.destroy(); return; }
  const upstream = request({ hostname: '127.0.0.1', port, path: incoming.url, headers: { ...incoming.headers, 'x-forwarded-proto': 'https' } });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
    socket.pipe(remote).pipe(socket);
    socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
  });
  upstream.on('error', () => socket.destroy()); upstream.end();
}
