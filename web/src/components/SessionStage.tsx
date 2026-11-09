import { Check, Flag, Mic, Radio, Users } from "lucide-react";

/** セッションの現在地。操作は各画面に置き、ここには次の行動だけを示す。 */
export function SessionStage({ stage, title, children }: { stage: "voice" | "waiting" | "live" | "ended" | "result"; title: string; children?: React.ReactNode }) {
  const Icon = { voice: Mic, waiting: Users, live: Radio, ended: Flag, result: Check }[stage];
  return <section className="session-stage" data-stage={stage} aria-label={title}>
    <span className="session-stage__icon" aria-hidden="true"><Icon size={26} strokeWidth={1.6} /></span>
    <div><h2 className="session-stage__title">{title}</h2>{children && <div className="session-stage__lead">{children}</div>}</div>
  </section>;
}
