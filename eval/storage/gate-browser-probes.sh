#!/usr/bin/env bash
# 2K-B.1 vacuity probes that need the real browser.
#
# Six mutations against the unavailable gate and the accounting. Each breaks a
# guarantee, rebuilds, and asserts the acceptance run goes red. The 2K-B
# browser probes live in browser-probes.sh and were validated there; these are
# the closure checkpoint's own.
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

  if npm run build >/dev/null 2>&1; then
    restart
    if node eval/storage/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# A — a note edit must stay closed when nothing can be saved
probe "A note editing comes back without storage" \
  src/components/workspace/Workspace.tsx \
  '  const canEdit =
    track !== undefined && isEditableTrack(track) && !previewOpen && canPersist;' \
  '  const canEdit =
    track !== undefined && isEditableTrack(track) && !previewOpen;'

# B — the bar-selection gesture must not arm
probe "B the bar gesture arms without storage" \
  src/components/workspace/Workspace.tsx \
  '            onSelectBars={canPersist ? selectBars : undefined}' \
  '            onSelectBars={selectBars}'

# C — the Copilot must not offer to apply
probe "C the Copilot opens without storage" \
  src/components/workspace/Workspace.tsx \
  '        arrangeDisabled={skills.length === 0 || previewOpen || !canPersist}' \
  '        arrangeDisabled={skills.length === 0 || previewOpen}'

# D — playback is not storage's hostage, in either direction
probe "D playback is disabled along with editing" \
  src/components/workspace/Workspace.tsx \
  '        onPlayPause={() => controller.toggle()}' \
  '        onPlayPause={() => {
          if (canPersist) controller.toggle();
        }}'

# E — the accounting wrapper exists before the first app instruction
probe "E the ledger is installed after the app has loaded" \
  eval/storage/verify.mjs \
  '  await context.addInitScript(INSTRUMENT);' \
  '  // installed too late on purpose — only future navigations get the wrapper.
  const armLate = async (page) => page.addInitScript(INSTRUMENT);
  void armLate;'

# F — the unavailable banner cannot be put down
probe "F the unavailable banner grows a dismiss control" \
  src/components/workspace/RecoveryBanner.tsx \
  '  const canDismiss =
    state !== "unsupported_version" && state !== "storage_unavailable";' \
  '  const canDismiss = state !== "unsupported_version";'

echo
echo "gate browser probes: $pass red, $fail vacuous"

npm run build >/dev/null 2>&1
restart
