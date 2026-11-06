/** この画面で扱うQRは、6文字のコードか同じサイトの /join?code=...。リンクは開かない。 */
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

export async function readQrImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("画像ファイルを選んでください。");
  if (file.size > 12 * 1024 * 1024) throw new Error("12MB以下の画像を選んでください。");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("画像を開けませんでした。JPEGやPNGの写真で試してください。"));
      image.src = url;
    });
    const { default: jsQR } = await import("jsqr");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("画像を読み取れませんでした。コード入力でも参加できます。");
    // 大きな写真の処理量を抑え、細かいQRだけ高い解像度でもう一度試す。
    for (const edge of [1200, 2400]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
      if (code) return code.data;
      if (scale === 1) break;
    }
    throw new Error("QRコードが見つかりません。明るい場所で、QR全体が写るように撮影してください。");
  } finally {
    URL.revokeObjectURL(url);
  }
}
