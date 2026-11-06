import Link from "next/link";
export default function Participate() {
  return <main className="screen"><div className="body"><h1>このセッションでの役割</h1><p>役割はセッションごとに選びます。</p><div className="mvp-actions">
    <section className="box pad-lg stack"><h2>ホスト</h2><p>セッションを作成し、設定・グループ・開始・終了を管理します。</p><Link className="btn btn--blue" href="/host/new">ホスト</Link></section>
    <section className="box pad-lg stack"><h2>ゲスト</h2><p>コードまたはQRで参加し、表示名と音声を登録します。</p><Link className="btn btn--yellow" href="/join">ゲスト</Link></section>
  </div><Link href="/home" className="btn">ホームに戻る</Link></div></main>;
}
