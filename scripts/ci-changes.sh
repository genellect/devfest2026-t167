#!/usr/bin/env bash
# PR で変更したファイルから、重い検査（scripts/dev.sh check）が要るかを決める。
# 文書だけの変更（*.md、docs/、PR テンプレート、LICENSE）なら code=false。それ以外は code=true。
# main への push・手動実行・差分が読めないときは、常に code=true。
# 文書だけの main への push は、deploy.yml の paths-ignore（同じ条件）で deploy ごと動かない。
# 使い方: scripts/ci-changes.sh <base> <head>    ファイル一覧を標準入力で渡すときは scripts/ci-changes.sh -
set -uo pipefail
is_doc() {
  case "$1" in
    *.md|docs/*|LICENSE) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "${1:-}" = "-" ]; then FILES=$(cat)
elif [ -n "${1:-}" ] && [ -n "${2:-}" ]; then FILES=$(git diff --name-only "$1...$2" 2>/dev/null) || FILES="__unreadable__"
else FILES="__all__"; fi
CODE=false
while IFS= read -r f; do
  [ -z "$f" ] && continue
  is_doc "$f" || { CODE=true; break; }
done <<< "$FILES"
[ -z "$FILES" ] && CODE=true   # 差分が空なら念のため全部
echo "code=$CODE"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "code=$CODE" >> "$GITHUB_OUTPUT"
exit 0
