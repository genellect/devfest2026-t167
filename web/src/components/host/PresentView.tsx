"use client";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Maximize, X } from "lucide-react";
import { millis, useCountdown, useInsights, useMembers, type Room } from "@/lib/room";

/**
 * 教室に投影する画面（教員だけが開ける）。操作画面とは分け、映してよいものだけを出す（商用の投影モードと同じ考え方）。
 * - 準備中：参加コードとQR、参加人数
 * - 議論中：テーマ、時間、教員が「全員に表示する」を押した問いかけ（未決定の AI の提案は出さない）
 * - 終了：結論を自分の言葉で書くよう案内する
 * 事前意見・発言メモ・結論の一文の本文は出さない。
 */
export function PresentView({ roomId, room }: { roomId: string; room: Room }) {
  const members = useMembers(roomId, true).filter((m) => m.role === "participant" && m.status !== "inactive");
  const seats = members.reduce((n, m) => n + (m.attendees?.length || 1), 0);
  const shown = useInsights(roomId, true, true);
  const ended = !!room.endedAt || room.phase === "closed";
  const [qr, setQr] = useState<string>();
  const code = room.joinCode ?? "";
  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`${window.location.origin}/join?code=${code}`, { margin: 1, width: 640 }).then(setQr).catch(() => setQr(undefined));
  }, [code]);

  return (
    <main className="present" aria-label="投影画面">
      <header className="present__bar">
        <p className="present__brand">Topos</p>
        <h1 className="present__theme">{room.theme || room.title}</h1>
        <div className="present__tools">
          <button type="button" className="present__tool" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="全画面にする" title="全画面にする"><Maximize aria-hidden="true" strokeWidth={1.75} /></button>
          <Link className="present__tool" href={`/rooms/${roomId}`} aria-label="操作画面に戻る" title="操作画面に戻る"><X aria-hidden="true" strokeWidth={1.75} /></Link>
        </div>
      </header>

      {room.phase === "collecting" && (
        <section className="present__join" aria-label="参加コード">
          <div className="present__code">
            <p className="present__label">スマホで参加</p>
            <p className="present__digits" data-testid="present-code" aria-label={code.split("").join(" ")}>{code.length === 6 ? <>{code.slice(0, 3)}<span aria-hidden="true"> </span>{code.slice(3)}</> : code}</p>
            <p className="present__hint">QR を読み取るか、6桁の数字を入力します</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr ? <img className="present__qr" src={qr} alt={`参加用のQRコード（参加コード ${code}）`} /> : <div className="present__qr" aria-hidden="true" />}
          <p className="present__count"><span className="num">{seats}</span>人が参加しています</p>
        </section>
      )}

      {!ended && room.phase !== "collecting" && <Live room={room} shown={shown.map((i) => i.summary)} />}

      {ended && (
        <section className="present__end" aria-label="議論の終了">
          <h2 className="present__headline">議論を終えました</h2>
          <p className="present__hint">スマホで、グループの結論を自分の言葉で書いてください。</p>
        </section>
      )}
    </main>
  );
}

function Live({ room, shown }: { room: Room; shown: string[] }) {
  const started = millis(room.startedAt);
  const clock = useCountdown(started, room.minutes ?? 15);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = started ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const time = room.endsAt ? clock.text : `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <section className="present__live" aria-label="議論中">
      <div className="present__timer">
        <p className="present__label">{room.endsAt ? "残り時間" : "経過時間"}</p>
        <p className="present__time" role="timer">{time}</p>
      </div>
      <div className="present__prompts">
        {shown.length ? <>
          <p className="present__label">先生からの問いかけ</p>
          <ul className="present__notes">{shown.map((s, i) => <li key={i} className="present__note">{s}</li>)}</ul>
        </> : <>
          <h2 className="present__headline">グループで話し合いましょう</h2>
          <p className="present__hint">話した内容は、スマホの「発言メモ」に短く書いてください。</p>
        </>}
      </div>
    </section>
  );
}
