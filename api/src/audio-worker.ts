import { parentPort, workerData } from 'node:worker_threads';
import { parseBuffer } from 'music-metadata';

/** MediaRecorder の WebM は Duration を持たないことがある。EBMLのクラスタ時刻とBlockの相対時刻を上限付きで読む。 */
function webmDuration(bytes: Buffer): number | undefined {
  let scale = 1_000_000, cluster = 0, last = -1, elements = 0;
  function vint(at: number, id = false): { value: number; length: number; unknown: boolean } {
    const first = bytes[at];
    if (!first) throw new Error('invalid_ebml');
    let length = 1, mask = 0x80;
    while (!(first & mask) && length < 8) { mask >>= 1; length++; }
    if (at + length > bytes.length) throw new Error('truncated_ebml');
    let value = id ? first : first & (mask - 1);
    let unknown = !id && value === mask - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[at + i]; unknown &&= bytes[at + i] === 255; }
    return { value, length, unknown };
  }
  function integer(start: number, end: number) {
    if (end - start > 6) throw new Error('oversized_integer');
    let value = 0; for (let i = start; i < end; i++) value = value * 256 + bytes[i]; return value;
  }
  // Segment の直下に並ぶ要素（長さ不明の Cluster は、次にこれらが現れたところで終わる）
  const LEVEL1 = [0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1043a770, 0x1941a469];
  /** 読み終えた位置を返す。insideUnknown なら、Segment の直下の要素が現れたところで止まる（そこが長さ不明の Cluster の終わり） */
  function walk(start: number, end: number, depth: number, insideUnknown = false): number {
    if (depth > 8) throw new Error('deep_ebml');
    let at = start;
    while (at < end) {
      if (++elements > 200_000) throw new Error('too_many_elements');
      const id = vint(at, true);
      if (insideUnknown && LEVEL1.includes(id.value)) return at;
      const size = vint(at + id.length);
      const body = at + id.length + size.length;
      if (size.unknown && ![0x18538067, 0x1f43b675].includes(id.value)) throw new Error('unsupported_unknown_size');
      // MediaRecorder（Chrome）は Segment と Cluster の長さを不明のまま書く。Cluster は次の Cluster の手前で終わる
      let stop = size.unknown ? end : body + size.value;
      if (stop > end || stop <= at) throw new Error('invalid_size');
      if ([0x18538067, 0x1549a966, 0x1f43b675, 0xa0].includes(id.value)) {
        const reached = walk(body, stop, depth + 1, size.unknown && id.value === 0x1f43b675);
        if (size.unknown) stop = reached;
      }
      else if (id.value === 0x2ad7b1) scale = integer(body, stop);
      else if (id.value === 0xe7) cluster = integer(body, stop);
      else if (id.value === 0xa3 || id.value === 0xa1) {
        const track = vint(body); const pos = body + track.length;
        if (pos + 3 > stop) throw new Error('invalid_block');
        last = Math.max(last, cluster + bytes.readInt16BE(pos));
      }
      // 完成したBlob内では未知長Segment/Clusterの終端を有限化できる。
      // music-metadataの未知長Clusterのignore(-1)を避けるため、解析用コピーだけを書き換える。
      if (size.unknown) {
        let length = BigInt(stop - body);
        if (length >= (1n << BigInt(size.length * 7)) - 1n) throw new Error('unknown_size_overflow');
        for (let i = size.length - 1; i >= 0; i--) { bytes[at + id.length + i] = Number(length & 255n); length >>= 8n; }
        bytes[at + id.length] |= 1 << (8 - size.length);
      }
      at = stop;
    }
    return at;
  }
  walk(0, bytes.length, 0);
  return last >= 0 ? last * scale / 1_000_000_000 + 1 : undefined;
}
try {
  const bytes = Buffer.from(workerData.audio);
  const inferredWebmDuration = workerData.mimeType.includes('webm') ? webmDuration(bytes) : undefined;
  const metadata = await parseBuffer(bytes, { mimeType: workerData.mimeType, size: bytes.length }, { duration: true, skipCovers: true });
  if (!metadata.format.codec || !metadata.format.numberOfChannels) throw new Error('missing_audio_track');
  const duration = metadata.format.duration ?? inferredWebmDuration;
  if (!duration || !Number.isFinite(duration)) throw new Error('unknown_duration');
  parentPort!.postMessage({ duration });
} catch { parentPort!.postMessage({ error: true }); }
