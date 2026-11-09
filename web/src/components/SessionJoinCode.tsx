"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function SessionJoinCode({ code }: { code: string }) {
  const [qr, setQr] = useState<string>(), [copied, setCopied] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(`${window.location.origin}/join?code=${code}`, { margin: 1, width: 520 }).then(value => { if (active) setQr(value); }).catch(() => { if (active) setQr(undefined); });
    return () => { active = false; };
  }, [code]);
  async function copy(link = false) {
    setCopied("");
    try { await navigator.clipboard.writeText(link ? `${window.location.origin}/join?code=${code}` : code); setCopied(link ? "参加リンクをコピーしました" : "参加コードをコピーしました"); }
    catch { setCopied("コピーできませんでした。参加コードを直接入力してください。"); }
  }
  return <section className="session-join" aria-label="参加コード">
    <div className="session-invite__access">
      <div className="session-invite__qr">{qr
        // eslint-disable-next-line @next/next/no-img-element
        ? <img className="lobby__qr" src={qr} alt={`参加用のQRコード（参加コード ${code}）`} />
        : <div className="lobby__qr" aria-hidden="true" />}</div>
      <div className="session-invite__code">
        <p className="t-note">参加コード</p>
        <p data-testid="join-code" className="lobby__digits" aria-label={code.split("").join(" ")}>{code.length === 6 ? <>{code.slice(0, 3)}<span aria-hidden="true"> </span>{code.slice(3)}</> : code}</p>
        <div className="session-lobby-actions"><button className="text-btn" onClick={() => void copy()}>コードをコピー</button><button className="text-btn" onClick={() => void copy(true)}>参加リンクをコピー</button></div>
      </div>
    </div>
    {copied && <p className="t-note" role="status">{copied}</p>}
  </section>;
}
