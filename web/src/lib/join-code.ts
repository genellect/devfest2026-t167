const KEY = "t167:pending-join-code";
/** QRやURLのコード。新しいコードは6桁の数字で、以前に作った英数字6文字のコードも受け付ける */
export const normalizeJoinCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
/** 手で入力するコード。数字だけを残す（全角の数字も半角にそろえる） */
export const typedJoinCode = (value: string) =>
  value.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/\D/g, "").slice(0, 6);

/** ログイン前にQRで開いたコードを同じタブに保ち、ログインのあとにそのまま参加する */
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
