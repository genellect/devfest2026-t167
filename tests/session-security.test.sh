#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
cat > "$task_tmp/gcloud" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$T167_SECURITY_CALLS"
MOCK
chmod +x "$task_tmp/gcloud"
export PATH="$task_tmp:$PATH" T167_SECURITY_CALLS="$task_tmp/calls"
bash "$root/infra/setup-session-security.sh" --plan >/dev/null
[ ! -e "$T167_SECURITY_CALLS" ]
bash "$root/infra/setup-session-security.sh" --apply
[ "$(wc -l < "$T167_SECURITY_CALLS" | tr -d ' ')" = 2 ]
grep -q 'fields ttls update deleteAt --collection-group=sessions --enable-ttl' "$T167_SECURITY_CALLS"
grep -q 'fields ttls update deleteAt --collection-group=securityEvents --enable-ttl' "$T167_SECURITY_CALLS"
if bash "$root/infra/setup-session-security.sh" --unknown >/dev/null 2>&1; then exit 1; fi
echo 'OK: session security plan/apply（偽gcloud・実クラウド変更なし）'
