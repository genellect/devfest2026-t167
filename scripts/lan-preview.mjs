#!/usr/bin/env node
// 起動済みのローカル開発環境の認証・DBを、指定したWi-Fiアドレスだけで中継する。
// 本物の資格情報やデータは使わず、信頼できる同一LANでの短時間の実機確認に使う。
import net from 'node:net';

const host = process.env.T167_LAN_HOST ?? '';
const offsetText = process.env.T167_TEST_PORT_OFFSET ?? '0';
const octets = host.split('.').map(Number);
const privateHost = net.isIPv4(host) && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
if (!privateHost || !/^\d{1,5}$/.test(offsetText) || Number(offsetText) > 40000) {
  console.error('T167_LAN_HOSTにMacのプライベートIPv4アドレス、T167_TEST_PORT_OFFSETに0〜40000を指定してください。');
  process.exit(1);
}
const offset = Number(offsetText);
const sockets = new Set();
const servers = [];
function stop() {
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
}
for (const base of [9099, 8080]) {
  const port = base + offset;
  const server = net.createServer(client => {
    const upstream = net.connect({ host: '127.0.0.1', port });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
    }
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
  servers.push(server);
  server.on('error', error => { console.error(`LAN中継を起動できません: ${error.code}`); stop(); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`エミュレータ中継: ${host}:${port}`));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log(`実機のSafariで http://${host}:${3000 + offset} を開いてください。終了はCtrl+C。`);
