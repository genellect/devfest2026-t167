/**
 * 参加者に見せる議論の名前。テーマを非公開にしたとき、テーマ本文を名前（title）経由で参加者へ出さない。
 * 以前の設定画面はテーマの保存時に title へテーマの先頭100文字を書いていたため、保存済みの title が
 * テーマと重なるときも伏せる。Host には常に元の値を返す（呼び出し側で判定する）。
 */
export const HIDDEN_THEME_TITLE = '話し合い';

export function titleRevealsTheme(title: unknown, theme: unknown): boolean {
  const name = typeof title === 'string' ? title.trim() : '';
  const body = typeof theme === 'string' ? theme.trim() : '';
  if (!name || !body) return false;
  return body.startsWith(name) || name.startsWith(body);
}

/** 参加者向けの名前。テーマを公開しているときはそのまま、非公開のときはテーマと重ならない名前だけを返す。 */
export function participantTitle(room: { title?: unknown; theme?: unknown; themeHidden: boolean }): string {
  const title = typeof room.title === 'string' ? room.title : '';
  if (!room.themeHidden) return title;
  return titleRevealsTheme(title, room.theme) ? HIDDEN_THEME_TITLE : title;
}

/** 以前の画面が送っていた「title = テーマの先頭100文字」の形か。キャッシュされた古い画面から名前を壊さないために使う。 */
export function isThemeCopiedIntoTitle(patch: { title?: string; theme?: string }, currentTitle: unknown): boolean {
  if (patch.title === undefined || patch.theme === undefined) return false;
  const fallback = typeof currentTitle === 'string' ? currentTitle : '';
  return patch.title === (patch.theme || fallback).slice(0, 100) && patch.title !== fallback;
}

/**
 * 録音の分析（Gemini）へ渡すテーマ。分析結果（results/flow-g*）は結果の公開後に参加者へ届くため、
 * テーマを非公開にしているあいだは参加者向けの名前だけを渡し、テーマ本文が結果の話題名などに写らないようにする。
 */
export function recordingAnalysisTheme(room: { get(field: string): unknown }): string {
  const title = typeof room.get('title') === 'string' ? room.get('title') as string : '';
  const theme = typeof room.get('theme') === 'string' ? room.get('theme') as string : '';
  if (room.get('participantView.theme') === false) return participantTitle({ title, theme, themeHidden: true });
  return theme || title;
}
