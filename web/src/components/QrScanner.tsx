"use client";
import { useEffect, useRef, useState } from "react";
import { decodeQrFrame, parseDiscussionQr } from "@/lib/discussion-qr";

/**
 * カメラで参加用のQRを読み取る。読み取れたら onCode にコードを渡して止まる。
 * 画面を離れたとき・閉じたときは、必ずカメラを止める。映像はどこにも送らない。
 */
export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("カメラを起動しています");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
    async function scan() {
      if (stopped || !video.current) return;
      const raw = await decodeQrFrame(video.current, canvas).catch(() => null);
      const code = raw ? parseDiscussionQr(raw, window.location.origin) : null;
      if (code) { stop(); onCode(code); return; }
      if (raw) setMessage("参加用のQRコードではありません");
      timer = setTimeout(() => void scan(), 200);
    }
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setMessage("QRコードを枠に合わせてください");
        void scan();
      } catch {
        setFailed(true);
        setMessage("カメラを使えません。ブラウザの設定でカメラを許可するか、コードを入力してください。");
      }
    })();
    return stop;
  }, [onCode]);

  return (
    <div className="qr-scan" role="dialog" aria-label="QRコードを読み取る">
      <div className="qr-scan__frame">
        <video ref={video} className="qr-scan__video" playsInline muted aria-hidden="true" />
        {!failed && <span className="qr-scan__guide" aria-hidden="true" />}
      </div>
      <p className="qr-scan__status" role="status">{message}</p>
      <button type="button" className="btn btn--block" onClick={onClose}>閉じる</button>
    </div>
  );
}
