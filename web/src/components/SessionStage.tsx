/** セッションの現在地。操作は各画面に置き、ここには次の行動だけを示す。 */
export function SessionStage({ stage, title, children }: { stage: "voice" | "waiting" | "live" | "ended" | "result"; title: string; children?: React.ReactNode }) {
  return <section className="session-stage" data-stage={stage} aria-label={title}>
    <div><h2 className="session-stage__title">{title}</h2>{children && <div className="session-stage__lead">{children}</div>}</div>
  </section>;
}
