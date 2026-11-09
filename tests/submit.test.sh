#!/usr/bin/env bash
# scripts/submit.sh の回帰テスト。ダミーの Git リポジトリで、止めるべきときに止まり、正常なときに開発の履歴ごとマージできるかを確かめる。
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); S="$ROOT/scripts/submit.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; cd "$T"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
# 提出用は運営の Initial commit だけがある状態から始める（README・LICENSE は開発用と衝突する）
mk() { rm -rf dev submit; git init -q -b main dev; git init -q -b main submit
  git -C submit remote add origin https://github.com/Devfest-Hackathon-2026/df-2026-t167
  printf '.env\n.env.*\n!.env.example\n' > dev/.gitignore; echo r > dev/README.md; echo l > dev/LICENSE
  mkdir -p dev/web dev/scripts; echo ok > dev/web/app.ts; cp "$S" dev/scripts/submit.sh
  printf 'env:\n  - variable: API_ORIGIN\n    value: https://api-123.asia-northeast1.run.app\n  - variable: GEMINI_KEY\n    secret: geminiKey@3\n' > dev/web/apphosting.production.yaml  # submit-allow: テスト用のダミー
  echo 'API_ORIGIN=http://127.0.0.1:8081' > dev/web/.env.example
  echo old > submit/old.txt; echo bot > submit/README.md; echo bot > submit/LICENSE; git -C submit add -A; git -C submit commit -qm init; }
commit() { git -C dev add -f -A; git -C dev commit -qm "${1:-c}"; }
FAILS=0
pass() { echo "PASS $1"; }
ng() { echo "FAIL $1"; [ -f out.txt ] && cat out.txt; FAILS=$((FAILS+1)); }
expect() { local want=$1 name=$2; shift 2; bash "$S" dev submit "$@" >out.txt 2>&1; local got=$?
  if { [ "$want" = ok ] && [ $got -eq 0 ]; } || { [ "$want" = ng ] && [ $got -ne 0 ]; }; then pass "$name"; else ng "$name"; fi; }
finish() { git -C submit commit -qm "Submission" >/dev/null; }
untouched() { [ -e submit/old.txt ] && [ "$(cat submit/README.md)" = bot ] && ! git -C submit rev-parse -q --verify MERGE_HEAD >/dev/null; }

# 正常系：開発用の履歴がそのまま入り、運営のコミットも残り、中身は開発用と同じになる
mk; commit first; echo two > dev/web/two.ts; commit second
expect ok "正常系（スクリプト自身・Secret 参照・.env.example を含む）"
finish
git -C submit merge-base --is-ancestor "$(git -C dev rev-parse main)" HEAD && pass "開発用のコミットが同じ SHA で残る" || ng "開発用のコミットが残らない"
[ "$(git -C submit rev-list --max-parents=0 HEAD | wc -l)" -eq 2 ] && [ "$(git -C submit rev-list --count HEAD)" -eq 4 ] \
  && pass "運営のコミットも残る（force push が要らない）" || ng "運営のコミットが消えた"
[ -z "$(git -C submit diff HEAD "$(git -C dev rev-parse main)")" ] && [ ! -e submit/old.txt ] \
  && pass "中身が開発用と同じで、古いファイルは残らない" || ng "中身が開発用と違う"
[ "$(git -C submit log -1 --format='%an %ad' "$(git -C dev rev-parse main~1)")" = "$(git -C dev log -1 --format='%an %ad' main~1)" ] \
  && pass "作者と日時が変わらない" || ng "作者か日時が変わった"

# 2回目以降：新しいコミットだけが加わる。反映済みなら何もしない
echo three > dev/web/three.ts; commit third
expect ok "2回目の反映"
grep -q '新しく入るコミット: 1 件' out.txt && pass "2回目は新しいコミットだけを数える" || ng "2回目の件数が違う"
finish
git -C submit merge-base --is-ancestor "$(git -C dev rev-parse main)" HEAD && pass "2回目のコミットも残る" || ng "2回目のコミットが残らない"
expect ok "反映済みなら何もしない"; grep -q 'すでに提出用リポジトリに入っています' out.txt && pass "反映済みと表示する" || ng "反映済みと表示しない"

# 止めるべきとき。どれも提出先に触れない
mk; commit; expect ng "存在しないブランチ" nope
untouched && pass "失敗時に提出先に触れない" || ng "提出先が変わった"
mk; commit; echo keep > submit/untracked.txt; expect ng "提出先に未追跡ファイル"
mk; commit; git -C submit remote set-url origin https://github.com/someone/other; expect ng "提出先の remote が違う"
mk; commit; git -C submit switch -q -c other; expect ng "提出先が main でない"
mk; commit; echo 2 > dev/web/app.ts; commit; rm -rf devs; git clone -q --depth 1 "file://$T/dev" devs
bash "$S" devs submit >out.txt 2>&1 && ng "開発用が shallow clone" || pass "開発用が shallow clone"
mk; echo X=1 > dev/.env.production; commit; expect ng "追跡済みの .env.production"
mk; echo 'PASSWORD=hunter2pass' > dev/web/config.txt; commit; expect ng "引用符なしの PASSWORD=値"  # submit-allow: テスト用のダミー
mk; echo 'DB_PASSWORD=hunter2pass' > dev/web/settings.yaml; commit; expect ng "YAML の引用符なしの値"  # submit-allow: テスト用のダミー
mk; printf "const x = { password: 'hunter2pass' };\n" > dev/web/leak.ts; commit; expect ng "コード中の文字列リテラル"  # submit-allow: テスト用のダミー
mk; printf "const x = { password: DEMO_PW };\n" > dev/web/ref.ts; commit; expect ok "コード中の変数参照は通す"  # submit-allow: テスト用のダミー
mk; printf "const pw = { password: 'emulator-only' }; // submit-allow: エミュレータ専用\n" > dev/web/seed.ts; commit; expect ok "submit-allow: を付けた行は通す"
mk; printf '  - variable: DB_PASSWORD\n    value: hunter2pass\n' >> dev/web/apphosting.production.yaml; commit; expect ng "apphosting の平文値"  # submit-allow: テスト用のダミー
mk; echo '{"db":{"password":"hunter2pass"}}' > dev/config.json; commit; expect ng "config.json のパスワード"  # submit-allow: テスト用のダミー
mk; printf -- '-----BEGIN PRIVATE KEY-----\nabc\n' > dev/k.txt; commit; expect ng "秘密鍵"  # submit-allow: テスト用のダミー
mk; printf 'const t = process.env.API_TOKEN;\n' > dev/web/env.ts; commit; expect ok "環境変数の参照は通す"  # submit-allow: テスト用のダミー

# 履歴の検査：最新版から消しても、過去のコミットに残っていれば止める
mk; commit; printf -- '-----BEGIN PRIVATE KEY-----\nabc\n' > dev/k.txt; commit leak; git -C dev rm -q k.txt; commit fix  # submit-allow: テスト用のダミー
expect ng "過去のコミットの秘密鍵"; grep -q '過去のコミット' out.txt && pass "過去のコミットだと分かるように表示する" || ng "過去のコミットだと表示しない"
untouched && pass "履歴の検査で止まったときも提出先に触れない" || ng "提出先が変わった"
mk; commit; echo X=1 > dev/.env.local; commit leak; git -C dev rm -q .env.local; commit fix
expect ng "過去のコミットの .env"
mk; commit; echo 'aws=AKIAABCDEFGHIJKLMNOP' > dev/web/config.txt; commit leak; git -C dev mv web/config.txt web/renamed.txt; commit mv; git -C dev rm -q web/renamed.txt; commit fix  # submit-allow: テスト用のダミー
expect ng "名前を変えてから消したファイルの鍵"
mk; commit; printf -- '-----BEGIN PRIVATE KEY-----  # submit-allow: テスト用のダミー\n' > dev/k.txt; commit allowed; git -C dev rm -q k.txt; commit fix
expect ok "過去のコミットでも submit-allow: を付けた行は通す"
# 推定による検査（引用符つきの代入など）は最新版だけ。過去の版にはあとから submit-allow: を付けられないため
mk; commit; printf "const x = { password: 'hunter2pass' };\n" > dev/web/leak.ts; commit old; printf "const x = { password: DEMO_PW };\n" > dev/web/leak.ts; commit fix  # submit-allow: テスト用のダミー
expect ok "過去の版の推定による検出では止めない"
[ $FAILS -eq 0 ] && echo "ALL PASS" || { echo "$FAILS FAILED"; exit 1; }
