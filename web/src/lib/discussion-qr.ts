/** この画面で扱うQRは、6文字のコードか同じサイトの /join?code=...。ほかのサイトのリンクは開かない。 */
export function parseDiscussionQr(raw: string, origin: string): string | null {
  const text = raw.trim();
  if (/^[a-z0-9]{6}$/i.test(text)) return text.toUpperCase();
  try {
    const url = new URL(text, origin);
    const codes = url.searchParams.getAll("code");
    if (url.origin !== origin || url.pathname !== "/join" ||
        url.username || url.password || codes.length !== 1) return null;
    return /^[a-z0-9]{6}$/i.test(codes[0]) ? codes[0].toUpperCase() : null;
  } catch {
    return null;
  }
}

/** カメラの1コマからQRを探す。見つからなければ null */
export async function decodeQrFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<string | null> {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const { default: jsQR } = await import("jsqr");
  // 処理量を抑えるため、長辺640pxに縮めて読む
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}
