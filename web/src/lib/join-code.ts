const KEY = "t167:pending-join-code";
export const normalizeJoinCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

/** QRのコードだけを同じタブに保つ。ログイン後もまずホームを開く。 */
export function rememberJoinCode(value: string) {
  const code = normalizeJoinCode(value);
  if (code.length !== 6) return;
  try { sessionStorage.setItem(KEY, code); } catch { /* 保存できなくてもログインは妨げない */ }
}
export function pendingJoinCode() {
  try { return normalizeJoinCode(sessionStorage.getItem(KEY) ?? ""); } catch { return ""; }
}
export function clearJoinCode() {
  try { sessionStorage.removeItem(KEY); } catch { /* 保存領域が使えない場合は不要 */ }
}
