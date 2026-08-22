#!/usr/bin/env bash
# 2L-R vacuity probes that need the real browser.
#
# Four mutations against behaviour only a running page can show: an undo that
# leaves a selection standing, a view switch that builds a second engine, a
# recovery gate that can be put down, and a second horizontal scroller. Each
# rebuilds (with the demo flag the regression suite documents) and asserts
# the acceptance run goes red.
set -u

pass=0; fail=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
}

probe() {
  local name="$1" file="$2" find="$3" repl="$4"
  cp "$file" "$file.probebak"
  python3 - "$file" "$find" "$repl" <<'PY'
import io,sys
p,f,r=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding="utf-8").read()
if f not in s:
    sys.stderr.write("ANCHOR MISSING: "+f[:70]+"\n"); sys.exit(2)
io.open(p,"w",encoding="utf-8").write(s.replace(f,r,1))
PY
  if [ $? -ne 0 ]; then echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"; return; fi

  if (rm -rf .next && NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true npm run build) >/dev/null 2>&1; then
    restart
    if ONE_VIEWPORT=1 node eval/orchestration-refactor/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 5 — an undo that leaves the selection standing
probe "5 undo skips the surface reset" \
  src/components/workspace/Workspace.tsx \
  '    if (!canUndo) return;
    pause();
    resetEditSurfaces();
    undo();' \
  '    if (!canUndo) return;
    pause();
    undo();'

# 8 — a view switch that builds a second engine
probe "8 the view switch builds an AudioContext" \
  src/components/workspace/Workspace.tsx \
  '          } else {
            navigation.showTab();
          }' \
  '          } else {
            new AudioContext();
            navigation.showTab();
          }'

# 10 — the recovery gate can be put down
probe "10 the storage banner becomes dismissible" \
  src/components/workspace/RecoveryBanner.tsx \
  '  const canDismiss =
    state !== "unsupported_version" && state !== "storage_unavailable";' \
  '  const canDismiss = true;'

# 16 — a second horizontal scroller at 320px
probe "16 a second horizontal scroller appears" \
  src/components/workspace/Workspace.tsx \
  '      <SelectionActionArea session={session} />' \
  '      <SelectionActionArea session={session} />
      <div style={{ overflowX: "auto" }}>
        <div style={{ width: 4000, height: 4 }} />
      </div>'

echo
echo "RED: $pass  VACUOUS: $fail"
# Leave a demo-flag build serving, as the regression suite documents.
(rm -rf .next && NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true npm run build) >/dev/null 2>&1
restart
[ "$fail" -eq 0 ]
