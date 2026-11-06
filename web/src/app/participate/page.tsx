import Link from 'next/link';
import { MvpGate } from '@/components/mvp/MvpGate';
import { Header } from '@/components/ui';
export default function Participate() { return <MvpGate><main className="screen"><Header title="参加する"><Link className="btn" href="/home">ホーム</Link></Header><div className="body grid-auto"><section className="box box--blue pad-lg stack"><h2>Host</h2><p>議論を作成し、設定・開始・終了と結果の公開を行います。</p><Link className="btn btn--yellow" href="/host/new">ホスト</Link></section><section className="box box--yellow pad-lg stack"><h2>Guest</h2><p>コードかQRから参加し、表示名と声を登録します。</p><Link className="btn btn--blue" href="/join">ゲスト</Link></section></div></main></MvpGate>; }
