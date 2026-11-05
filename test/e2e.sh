#!/usr/bin/env bash
# Reproduces: Abi fixes a bug, teammate's AI ports legacy code over it, merge is conflict-free.
set -u
FG="node $(cd "$(dirname "$0")/.." && pwd)/bin/fixlock.js"
T=$(mktemp -d); cd "$T"
git init -q -b main origin.git --bare >/dev/null 2>&1 || git init -q --bare origin.git
git clone -q origin.git app 2>/dev/null; cd app
git config user.email abi@fluxo.dev; git config user.name Abi
mkdir -p src/app/core/utils
cat > src/app/core/utils/date.util.ts <<'TS'
export function toSapDate(d: Date): string {
  return d.toISOString();
}
TS
git add . && git commit -qm init && git push -q origin HEAD:main

# Abi fixes the bug
cat > src/app/core/utils/date.util.ts <<'TS'
export function toSapDate(d: Date): string {
  // SAP B1 Service Layer rejects timestamps; send yyyy-MM-dd in local time
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
TS
$FG init >/dev/null
$FG mark src/app/core/utils/date.util.ts 3-4 -m "SAP B1 rejects ISO timestamps for DocDate" --title "SAP date format" --test date.util.spec.ts
git add . && git commit -qm "fix: SAP date format" && git push -q origin HEAD:main
echo "== clean check on main =="; $FG check --base origin/main; echo "exit=$?"

# Teammate branch: AI overwrites the file with the legacy portal's version
git checkout -qb feature/port-orders
git config user.email dev2@fluxo.dev; git config user.name Dev2
cat > src/app/core/utils/date.util.ts <<'TS'
export function toSapDate(d: Date): string {
  return d.toISOString();
}

export function formatOrderDate(d: Date) { return d.toLocaleDateString(); }
TS
git commit -qam "feat: port order screen from legacy portal"
echo; echo "== does git see a conflict? =="; git checkout -q main; git merge --no-commit --no-ff feature/port-orders >/dev/null 2>&1 && echo "no conflict — git would merge it silently"; git merge --abort; git checkout -q feature/port-orders
echo; echo "== fixlock on the PR branch =="; $FG check --base origin/main --markdown report.md; code=$?; echo "exit=$code"
echo; echo "== CLAUDE.md section =="; sed -n '/fixlock:start/,/fixlock:end/p' CLAUDE.md
[ "$code" = 1 ] && echo "E2E PASS" || { echo "E2E FAIL"; exit 1; }
