#!/usr/bin/env bash
# scripts/dev.sh pr の回帰テスト。GitHub には接続しない（gh は記録だけする偽物、origin は手元の bare リポジトリ）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok() { pass=$((pass+1)); echo "PASS $1"; }
ng() { fail=$((fail+1)); echo "FAIL $1"; }

mkdir -p "$T/bin"
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "auth status") exit 0 ;;
  "pr view") if [ "$3" = "--json" ] && [ "$4" = "number" ]; then [ -f "$GH_HAS_PR" ]; exit; fi; echo "https://github.com/example/repo/pull/1" ;;
  "pr create") while [ $# -gt 0 ]; do [ "$1" = "--body-file" ] && cp "$2" "$GH_BODY"; shift; done; touch "$GH_HAS_PR" ;;
  "pr merge") ;;
esac
EOF
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" T167_PR_SKIP_CHECK=1 GH_LOG="$T/gh.log" GH_BODY="$T/body.md" GH_HAS_PR="$T/has-pr"
G() { git -c user.name=t -c user.email=t@example.invalid "$@"; }

fresh() {
  rm -rf "$T/origin.git" "$T/w" "$GH_LOG" "$GH_BODY" "$GH_HAS_PR"
  git init -q --bare -b main "$T/origin.git"
  git init -q -b main "$T/w"
  mkdir -p "$T/w/scripts" "$T/w/.github"
  cp "$ROOT/scripts/dev.sh" "$T/w/scripts/"
  cp "$ROOT/.github/pull_request_template.md" "$T/w/.github/"
  (cd "$T/w" && G add -A && G commit -qm init && git remote add origin "$T/origin.git" && git push -q origin main 2>/dev/null)
}
run() { (cd "$T/w" && bash scripts/dev.sh pr "$@") > "$T/out" 2>&1; }

fresh
run && ng "main では止まる" || { grep -q "main では実行できません" "$T/out" && ok "main では止まる" || ng "main では止まる（$(cat "$T/out")）"; }

fresh
(cd "$T/w" && git switch -qc feat/a && echo x > a.txt)
run && ng "未コミットの変更があれば止まる" || { grep -q "コミットしていない変更" "$T/out" && ok "未コミットの変更があれば止まる" || ng "未コミットの変更があれば止まる"; }

fresh
(cd "$T/w" && git switch -qc feat/a && mkdir -p web && echo x > web/a.ts && G add -A && G commit -qm "feat(web): 一つ目" && echo y >> web/a.ts && G commit -qam "fix(web): 二つ目")
if run; then
  grep -q "^pr create --base main --title feat(web): 一つ目" "$GH_LOG" && ok "PR のタイトルは最初のコミットの件名" || ng "PR のタイトル（$(cat "$GH_LOG")）"
  grep -q "^- feat(web): 一つ目$" "$GH_BODY" && grep -q "^- fix(web): 二つ目$" "$GH_BODY" && ok "本文の変更内容にコミットの件名が入る" || ng "本文の変更内容"
  ! grep -q "^pr merge" "$GH_LOG" && grep -q "承諾を依頼" "$T/out" && ok "既定では auto-merge を付けず、承諾の依頼を案内する" || ng "既定の auto-merge（$(cat "$GH_LOG")）"
  git -C "$T/origin.git" rev-parse -q --verify refs/heads/feat/a >/dev/null && ok "ブランチを push する" || ng "push"
else ng "通常の PR（$(cat "$T/out")）"; fi

fresh
(cd "$T/w" && git switch -qc feat/c && echo x > c.txt && G add -A && G commit -qm "feat: c")
if run --approved; then
  grep -q "^pr merge --auto --squash --delete-branch" "$GH_LOG" && ok "--approved（本番反映の承諾後）で auto-merge を付ける" || ng "--approved（$(cat "$GH_LOG")）"
else ng "--approved の PR（$(cat "$T/out")）"; fi
run --merge-now && ng "知らない指定は止まる" || ok "知らない指定は止まる"

for rules_path in firebase/firestore.rules firebase/storage.rules; do
  fresh
  (cd "$T/w" && git switch -qc fix/rules && mkdir -p firebase && echo x > "$rules_path" && G add -A && G commit -qm "fix(firebase): Rules")
  if run --approved; then
    ! grep -q "^pr merge" "$GH_LOG" && grep -q "auto-merge を付けません" "$T/out" && ok "$rules_path の変更には承諾後でも auto-merge を付けない（レビューが要る）" || ng "$rules_path の変更"
  else ng "Rules の PR（$(cat "$T/out")）"; fi
done

fresh
(cd "$T/w" && git switch -qc feat/b && echo x > b.txt && G add -A && G commit -qm "feat: b")
if run --no-merge; then
  ! grep -q "^pr merge" "$GH_LOG" && ok "--no-merge では auto-merge を付けない" || ng "--no-merge"
  touch "$GH_HAS_PR"; : > "$GH_LOG"; (cd "$T/w" && echo y >> b.txt && G commit -qam "fix: b2")
  run && ! grep -q "^pr create" "$GH_LOG" && ok "PR があれば作り直さない" || ng "既存の PR（$(cat "$T/out")）"
else ng "--no-merge の PR（$(cat "$T/out")）"; fi

echo "dev-pr: ${pass} PASS / ${fail} FAIL"
[ "$fail" -eq 0 ]
