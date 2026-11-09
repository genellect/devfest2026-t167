#!/usr/bin/env bash
# 開発用リポジトリの指定コミットを、開発の履歴ごと提出用リポジトリにマージする。
# 開発用のコミットは SHA・作者・日時・メッセージを変えずに残り、提出用の既存のコミット（運営の Initial commit など）も残る。force push は使わない。
# 使い方: scripts/submit.sh <開発用リポジトリ> <提出用リポジトリ> [コミットまたはブランチ（既定 main）]
# すべての検査が終わるまで提出先には一切触れない。commit と push は人が確認してから行う。
set -euo pipefail
DEV="${1:?開発用リポジトリのパスを指定してください}"
SUBMIT="${2:?提出用リポジトリのパスを指定してください}"
REF="${3:-main}"
EXPECTED_REMOTE="${SUBMIT_REMOTE:-github.com/Devfest-Hackathon-2026/df-2026-t167}"
fail() { echo "NG: $*" >&2; exit 1; }
# 提出用リポジトリにそのコミットがあり、main の履歴に含まれているか
submitted() { git -C "$SUBMIT" cat-file -e "${1}^{commit}" 2>/dev/null && git -C "$SUBMIT" merge-base --is-ancestor "$1" "$SUB_HEAD"; }

# ---- 1. 入力の検証（ここまでは何も変更しない） ----
DEV_TOP=$(git -C "$DEV" rev-parse --show-toplevel 2>/dev/null) || fail "$DEV は Git リポジトリではありません"
SUB_TOP=$(git -C "$SUBMIT" rev-parse --show-toplevel 2>/dev/null) || fail "$SUBMIT は Git リポジトリではありません"
[ "$(cd "$DEV" && pwd -P)" = "$DEV_TOP" ] || fail "$DEV はリポジトリの最上位ではありません"
[ "$(cd "$SUBMIT" && pwd -P)" = "$SUB_TOP" ] || fail "$SUBMIT はリポジトリの最上位ではありません"
[ "$DEV_TOP" != "$SUB_TOP" ] || fail "開発用と提出用に同じリポジトリが指定されています"
REMOTE=$(git -C "$SUBMIT" remote get-url origin 2>/dev/null || true)
case "$REMOTE" in *"$EXPECTED_REMOTE"*) ;; *) fail "提出用リポジトリの origin が $EXPECTED_REMOTE ではありません（$REMOTE）";; esac
COMMIT=$(git -C "$DEV" rev-parse --verify --quiet "${REF}^{commit}") || fail "コミット $REF が開発用リポジトリにありません"
[ "$(git -C "$DEV" rev-parse --is-shallow-repository)" = false ] \
  || fail "開発用リポジトリの履歴が欠けています（shallow clone）。--depth を付けずに clone し直すか、git -C \"$DEV\" fetch --unshallow を実行してください"
[ "$(git -C "$SUBMIT" rev-parse --is-shallow-repository)" = false ] \
  || fail "提出用リポジトリの履歴が欠けています（shallow clone）。--depth を付けずに clone し直してください"
[ "$(git -C "$SUBMIT" branch --show-current)" = main ] || fail "提出用リポジトリで main を checkout してから実行してください"
SUB_HEAD=$(git -C "$SUBMIT" rev-parse --verify --quiet HEAD) || fail "提出用リポジトリにコミットがありません"
[ -z "$(git -C "$SUBMIT" status --porcelain --untracked-files=all)" ] \
  || fail "提出用リポジトリに未コミットまたは未追跡のファイルがあります。退避してから実行してください"
if submitted "$COMMIT"; then
  echo "OK: $(git -C "$DEV" rev-parse --short "$COMMIT") はすでに提出用リポジトリに入っています。することはありません"
  exit 0
fi

# ---- 2. 一時ディレクトリに書き出して検査する ----
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
TIP="$WORK/tip"; HIST="$WORK/history"; mkdir -p "$TIP" "$HIST"
git -C "$DEV" archive "$COMMIT" | tar -x -C "$TIP"

[ -f "$TIP/README.md" ] || fail "README.md がありません"
[ -f "$TIP/LICENSE" ] || fail "LICENSE がありません"

# 今回新しく公開するコミット（提出用リポジトリにまだないもの）が持ち込んだファイルを、すべて書き出す。
# 公開リポジトリに履歴ごと push すると、過去のコミットの中身も誰でも見られるため、最新版だけでなく履歴も検査する。
EXCLUDE=()
for C in $(git -C "$DEV" rev-list "$COMMIT"); do submitted "$C" && EXCLUDE+=("^$C"); done
NEW_COMMITS=$(git -C "$DEV" rev-list --count "$COMMIT" ${EXCLUDE[@]+"${EXCLUDE[@]}"})
# パスは -z（NUL 区切り）で受け取る。既定の出力では日本語などのパスが引用符付きに変形され、.p12 などのファイル名の検査をすり抜けるため
git -C "$DEV" rev-list "$COMMIT" ${EXCLUDE[@]+"${EXCLUDE[@]}"} \
  | git -C "$DEV" diff-tree --stdin -z -r -m --root --no-commit-id --diff-filter=AMRCT --format= \
  | while IFS= read -r -d '' META; do
      case "$META" in :*) ;; *) continue ;; esac   # コミットの区切りの空の項目は飛ばす
      read -r _ MODE _ BLOB STATUS <<< "$META"
      IFS= read -r -d '' FILE
      case "$STATUS" in R*|C*) IFS= read -r -d '' FILE ;; esac   # 名前の変更・複製は、変更後のパスが2つ目に来る
      [ "$MODE" = 160000 ] && continue   # サブモジュール
      mkdir -p "$HIST/${BLOB:0:12}/$(dirname -- "$FILE")"
      git -C "$DEV" cat-file blob "$BLOB" > "$HIST/${BLOB:0:12}/$FILE"
    done

# 検出パターンは断片をつないで作る。こうするとこのスクリプト自身は検出に引っかからない。
PK="PRIV""ATE KEY"; PKJ='"private''_key"'
KEYWORDS='(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key)'
SREF="secr""et"
ALLOWED_LOG="$WORK/allowed"; : > "$ALLOWED_LOG"

# 引数のディレクトリ以下を検査し、見つかったものを1行ずつ表示する。見つからなければ何も出さない。
# 2つ目の引数が keys-only なら、ファイル名と鍵そのものの形式だけを調べる（過去のコミット用）。
# 過去のコミットは書き換えられず、あとから submit-allow: を付けられないので、誤検出しやすい推定の検査は最新版だけに行う
scan() {
  local DIR=$1 MODE=${2:-full} HITS="" H P Y
  H=$(cd "$DIR" && find . -type f \( -name '.env' -o -name '.env.*' -o -name '.dev.vars' \
    -o -name '*.pem' -o -name '*.p12' -o -name '*.key' -o -iname '*service*account*.json' \
    -o -iname '*credential*.json' -o -iname '*-key.json' \) ! -name '.env.example' | sed 's#^\./##' | sort)
  [ -n "$H" ] && HITS+="$(printf '%s\n' "$H" | sed 's/$/: 秘密情報になりやすいファイルです（git rm --cached で外してください）/')"$'\n'
  # 鍵そのものの形式。すべてのファイル（lockfile も含む）を検査する
  local PATTERNS=(
    "-----BEGIN [A-Z ]*${PK}-----"
    "${PKJ}"
    'AKIA[0-9A-Z]{16}'
    'gh[pousr]_[A-Za-z0-9]{36}'
    'xox[baprs]-[A-Za-z0-9-]{10,}'
    'sk-[A-Za-z0-9_-]{20,}'
  )
  for P in "${PATTERNS[@]}"; do
    H=$(grep -rniE --binary-files=without-match -- "$P" "$DIR" || true)
    [ -n "$H" ] && HITS+="$H"$'\n'
  done
  if [ "$MODE" != keys-only ]; then
    # 名前に password・token などを含む項目への、引用符で囲んだ値の代入。lockfile はパッケージ名（jsonwebtoken など）に反応するので除く
    local QUOTED="${KEYWORDS}[A-Za-z0-9_]*[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"'[:space:]]{6,}"
    H=$(grep -rniE --binary-files=without-match --exclude='package-lock.json' -- "$QUOTED" "$DIR" || true)
    [ -n "$H" ] && HITS+="$H"$'\n'
    # 引用符なしの代入（PASSWORD=値 など）は、コード以外のファイルで検出する。コードでは変数の参照と区別できないため
    local UNQUOTED="${KEYWORDS}[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*[^\"'[:space:]\$\{<(]{6,}"
    H=$(grep -rniE --binary-files=without-match \
          --exclude='*.ts' --exclude='*.tsx' --exclude='*.mts' --exclude='*.cts' --exclude='*.js' --exclude='*.mjs' --exclude='*.cjs' --exclude='package-lock.json' \
          --exclude='*.md' --exclude='*.json' -- "$UNQUOTED" "$DIR" || true)
    [ -n "$H" ] && HITS+="$H"$'\n'
  fi
  # 人が確認したテスト用の値（エミュレータ専用のダミーなど）は、その行に submit-allow: と書くと通す
  printf '%s' "$HITS" | grep 'submit-allow:' >> "$ALLOWED_LOG" || true
  HITS=$(printf '%s' "$HITS" | grep -v 'submit-allow:' || true)
  # 例外として通すのは、App Hosting の YAML にある Secret Manager の参照行だけ
  HITS=$(printf '%s' "$HITS" | grep -vE "/apphosting(\.[a-z]+)?\.yaml:[0-9]+:[[:space:]]*-?[[:space:]]*${SREF}:[[:space:]]*[A-Za-z0-9_-]+(@[0-9]+)?[[:space:]]*\$" | sed '/^$/d' || true)
  # App Hosting の YAML では、名前と値が別の行になる（variable: 行と value: 行）。名前に危険な語を含む変数の value: を検出する
  [ "$MODE" = keys-only ] || while IFS= read -r Y; do
    [ -z "$Y" ] && continue
    H=$(awk -v kw="$KEYWORDS" -v f="${Y#./}" '
      BEGIN { IGNORECASE = 1 }
      /variable:/ { name = $0; sub(/.*variable:[[:space:]]*/, "", name); hot = (tolower(name) ~ kw) ; next }
      /^[[:space:]]*-[[:space:]]/ { hot = 0 }
      hot && /value:/ { print f ":" NR ": " name " に平文の値があります（Secret Manager の参照にしてください）"; hot = 0 }
    ' "$DIR/$Y")
    [ -n "$H" ] && HITS+=$'\n'"$H"
  done < <(cd "$DIR" && find . -type f -name 'apphosting*.yaml')
  printf '%s\n' "$HITS" | sed '/^$/d' | sed "s#^$DIR/##"
}

HITS=$(scan "$TIP")
[ -z "$HITS" ] || fail "最新版に秘密情報らしき値が見つかりました。確認して取り除いてください:
$HITS"
HITS=$(scan "$HIST" keys-only)
[ -z "$HITS" ] || fail "過去のコミットに秘密情報が見つかりました（行頭の12文字は blob の ID。git -C \"$DEV\" log --all --find-object=<ID> でコミットを探せます）。
本物の鍵なら、すぐに無効にして作り直してください。開発用リポジトリも公開されているので、履歴から消すだけでは足りません:
$HITS"

# ---- 3. 検査を通ったものだけを提出先にマージする ----
# -s ours でマージの形だけを作り、中身は指定コミットと完全に同じにする。前回の古いファイルは残らない
git -C "$SUBMIT" fetch -q "$DEV_TOP" "$COMMIT"
git -C "$SUBMIT" merge -q --no-commit --no-ff --allow-unrelated-histories -s ours "$COMMIT" >/dev/null 2>&1 \
  || fail "マージを始められませんでした（git -C \"$SUBMIT\" merge --abort で元に戻してください）"
git -C "$SUBMIT" read-tree -u --reset "$COMMIT"
git -C "$SUBMIT" diff --cached --quiet "$COMMIT" \
  || fail "マージ後の中身が $COMMIT と一致しません（git -C \"$SUBMIT\" merge --abort で元に戻してください）"
SHORT=$(git -C "$DEV" rev-parse --short "$COMMIT")
echo "== 提出用リポジトリに新しく入るコミット: ${NEW_COMMITS} 件（作者ごとの件数）=="
git -C "$DEV" shortlog -sne "$COMMIT" ${EXCLUDE[@]+"${EXCLUDE[@]}"} </dev/null
echo "== 提出用リポジトリのファイルの変更（A=追加 M=変更 D=削除）=="
git -C "$SUBMIT" diff --cached --name-status "$SUB_HEAD"
ALLOWED=$(grep -c . "$ALLOWED_LOG" || true)
[ "${ALLOWED:-0}" -gt 0 ] && echo "注意: submit-allow: で許可した行が ${ALLOWED} 行あります（最新版と履歴の合計。内容を確認してください）"
echo "OK: ${SHORT} までの履歴で検査を通過しました。確認してから次を実行してください:"
echo "  git -C \"$SUBMIT\" commit -m \"Submission ${SHORT}\" && git -C \"$SUBMIT\" push origin main"
echo "やり直すとき: git -C \"$SUBMIT\" merge --abort"
