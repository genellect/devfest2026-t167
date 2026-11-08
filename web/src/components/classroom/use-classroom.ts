"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHostUser } from "@/lib/hostAuth";
import { authorizeWorkspace, forgetWorkspace, SCOPES, workspaceRequest, workspaceToken, type Course } from "@/lib/workspace";
export const classroomMock = process.env.NEXT_PUBLIC_USE_EMULATORS === "1" && process.env.NEXT_PUBLIC_CLASSROOM_MOCK === "1";
export function useClassroom() {
  const uid = useHostUser()?.uid;
  const version = useRef(0);
  const [state, setState] = useState<{ uid?: string; courses?: Course[]; syncedAt?: number; busy?: boolean; error?: string }>({});
  const load = useCallback(async (token: string, generation: number) => {
    const data = await workspaceRequest<{ courses: Course[]; syncedAt: number }>("/integrations/classroom/courses", { token });
    if (generation === version.current) setState({ uid, ...data });
  }, [uid]);
  useEffect(() => {
    const request = version; const generation = ++request.current;
    setState({ uid });
    try { const token = workspaceToken(); setState({ uid, busy: true }); void load(token, generation).catch(e => { if (generation === version.current) setState({ uid, error: (e as Error).message }); }); }
    catch { /* このタブに追加許可がない。利用者が連携ボタンを押すまでOAuthを開かない。 */ }
    return () => { request.current++; };
  }, [uid, load]);
  async function connect() {
    const generation = ++version.current; setState({ uid, busy: true });
    try { await load(await authorizeWorkspace(SCOPES.classroom), generation); }
    catch (e) { if (generation === version.current) setState({ uid, error: (e as Error).message }); }
  }
  function disconnect() { version.current++; forgetWorkspace(); setState({ uid }); }
  return { ...(state.uid === uid ? state : {}), connect, disconnect };
}
export function syncLabel(at?: number) { return at ? `最終同期：${new Date(at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}` : ""; }
