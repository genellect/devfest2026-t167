import { parentPort, workerData } from 'node:worker_threads';
import { parseBuffer } from 'music-metadata';

/** ファイルの末尾で途中までの要素（at はその要素の先頭） */
class Truncated { at: number; constructor(at: number) { this.at = at; } }
/**
 * MediaRecorder の WebM は Duration を持たないことがある。EBMLのクラスタ時刻とBlockの相対時刻を上限付きで読む。
 * - Chrome は Segment と Cluster の長さを不明のまま書き、Cluster を一定の間隔で作る。長さ不明の Cluster は、
 *   Segment の直下の要素（次の Cluster など）が現れたところで終わる
 * - 画面を開き直す前の書きかけの録音は、MediaRecorder の区切り（要素の途中のこともある）で終わる。
 *   ファイルの末尾で途中までの要素があれば、書き終えた要素までを使う（length がその長さ）
 */
function webmDuration(bytes: Buffer): { duration: number | undefined; length: number } {
  let scale = 1_000_000, cluster = 0, last = -1, elements = 0;
  function vint(at: number, id = false): { value: number; length: number; unknown: boolean } {
    if (at >= bytes.length) throw new Truncated(at);
    const first = bytes[at];
    if (!first) throw new Error('invalid_ebml');
    let length = 1, mask = 0x80;
    while (!(first & mask) && length < 8) { mask >>= 1; length++; }
    if (at + length > bytes.length) throw new Truncated(at);
    let value = id ? first : first & (mask - 1);
    let unknown = !id && value === mask - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[at + i]; unknown &&= bytes[at + i] === 255; }
    return { value, length, unknown };
  }
  function integer(start: number, end: number) {
    if (end - start > 6) throw new Error('oversized_integer');
    let value = 0; for (let i = start; i < end; i++) value = value * 256 + bytes[i]; return value;
  }
  /** 長さ不明の要素の長さを、解析用コピーの中で有限にする（music-metadata が長さ不明の Cluster を読めないため） */
  function finite(at: number, idLength: number, sizeLength: number, body: number, stop: number) {
    let length = BigInt(stop - body);
    if (length >= (1n << BigInt(sizeLength * 7)) - 1n) throw new Error('unknown_size_overflow');
    for (let i = sizeLength - 1; i >= 0; i--) { bytes[at + idLength + i] = Number(length & 255n); length >>= 8n; }
    bytes[at + idLength] |= 1 << (8 - sizeLength);
  }
  // Segment の直下に並ぶ要素
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
      let stop = size.unknown ? end : body + size.value;
      // 中身がファイルの末尾を越える要素は、書きかけ。ファイルの途中で親を越えるなら、壊れている
      if (stop > bytes.length) throw new Truncated(at);
      if (stop > end || stop <= at) throw new Error('invalid_size');
      if ([0x18538067, 0x1549a966, 0x1f43b675, 0xa0].includes(id.value)) {
        try { const reached = walk(body, stop, depth + 1, size.unknown && id.value === 0x1f43b675); if (size.unknown) stop = reached; }
        catch (e) {
          if (!(e instanceof Truncated)) throw e;
          // 長さ不明の Segment・Cluster は、書き終えたところで閉じる。長さの決まった要素は、その要素ごと除く
          if (!size.unknown) throw new Truncated(at);
          finite(at, id.length, size.length, body, e.at);
          throw e;
        }
      }
      else if (id.value === 0x2ad7b1) scale = integer(body, stop);
      else if (id.value === 0xe7) cluster = integer(body, stop);
      else if (id.value === 0xa3 || id.value === 0xa1) {
        const track = vint(body); const pos = body + track.length;
        if (pos + 3 > stop) throw new Error('invalid_block');
        last = Math.max(last, cluster + bytes.readInt16BE(pos));
      }
      if (size.unknown) finite(at, id.length, size.length, body, stop);
      at = stop;
    }
    return at;
  }
  let length = bytes.length;
  try { walk(0, bytes.length, 0); }
  catch (e) { if (!(e instanceof Truncated)) throw e; length = e.at; }
  return { duration: last >= 0 ? last * scale / 1_000_000_000 + 1 : undefined, length };
}
try {
  const bytes = Buffer.from(workerData.audio);
  const webm = workerData.mimeType.includes('webm') ? webmDuration(bytes) : undefined;
  const inferredWebmDuration = webm?.duration;
  // 書きかけの録音は、書き終えた要素までを読む
  const readable = webm ? bytes.subarray(0, webm.length) : bytes;
  const metadata = await parseBuffer(readable, { mimeType: workerData.mimeType, size: readable.length }, { duration: true, skipCovers: true });
  if (!metadata.format.codec || !metadata.format.numberOfChannels) throw new Error('missing_audio_track');
  const duration = metadata.format.duration ?? inferredWebmDuration;
  if (!duration || !Number.isFinite(duration)) throw new Error('unknown_duration');
  parentPort!.postMessage({ duration });
} catch { parentPort!.postMessage({ error: true }); }
