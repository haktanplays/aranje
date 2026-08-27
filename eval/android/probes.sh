#!/usr/bin/env bash
# Can this harness fail? Twelve mutations that say it can (K-59.1 §9).
#
# The previous harness went green on its first run and stayed green while a
# person found four defects on the same build — because it clicked "next"
# through the steps without ever doing them. Every probe below breaks one
# guarantee the harness now claims to hold, rebuilds the production app, runs
# the harness and asserts it reports the *named* failure, not merely that it
# exited non-zero.
#
#   ./eval/chord-audio/serve.sh   # once, for the clean baseline
#   ./eval/android/probes.sh
set -u

pass=0; fail=0; skipped=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-android-server.log 2>&1 &); sleep 6
}

# probe <name> <expected-failure-substring> <file> <find1> <repl1> [...]
probe() {
  local name="$1" expect="$2" file="$3"; shift 3
  if [ -e "$file.probebak" ]; then
    echo "ABORT $name: $file.probebak exists — another probe run is in flight"
    exit 2
  fi
  cp "$file" "$file.probebak"
  python3 - "$file" "$@" <<'PY'
import io,sys
path=sys.argv[1]; pairs=sys.argv[2:]
s=io.open(path,encoding="utf-8").read()
for i in range(0,len(pairs),2):
    f,r=pairs[i],pairs[i+1]
    if f not in s:
        sys.stderr.write("ANCHOR MISSING: "+f[:70]+"\n"); sys.exit(2)
    s=s.replace(f,r,1)
io.open(path,"w",encoding="utf-8").write(s)
PY
  if [ $? -ne 0 ]; then
    echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"
    skipped=$((skipped+1)); return
  fi

  if npm run build >/dev/null 2>&1; then
    restart
    if node eval/android/harness.mjs >/tmp/aranje-android-probe.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    elif grep -qF "$expect" /tmp/aranje-android-probe.log; then
      echo "RED   $name  ($expect)"; pass=$((pass+1))
    else
      echo "WRONG $name  (red, but not for \"$expect\")"
      grep '^FAIL' /tmp/aranje-android-probe.log | head -1 | cut -c1-160
      fail=$((fail+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

STAGE=src/lib/workspace/workspace-stage.ts
GROUND=src/lib/workspace/use-session-ground.ts
OWNER=src/lib/tab/pointer-ownership.ts
GHOST=src/lib/tab/pen-ghost.ts
BAR=src/components/workspace/FrettedBarBlock.tsx
EVIDENCE=src/lib/acceptance/evidence.ts
WATCH=src/components/acceptance/useAcceptanceWatch.ts
TRANSIT=src/lib/acceptance/transitions.ts
REPORT=src/lib/acceptance/report.ts

# 1 — the route opens where the live run found it: on the arrangement.
probe "B1 route starts on Düzen" "route did not open on the tab" "$STAGE" \
  '    it.navigation.showTab();' '    void it;' \
  'const plan = stagePlan(stageName);' 'const plan = stagePlan(stageName);'
# (anchor lives in the ground; retargeted below)

# 2 — steps stop cleaning up after themselves.
probe "B2 no cleanup between steps" "listening step inherited" "$GROUND" \
  '    it.overlays.close();
    it.resetEditSurfaces();' '    it.overlays.close();'

# 3 — the pen stops owning the press, so both gestures run again.
probe "B3 long press wins over the pen" "a time selection opened under the pen" "$OWNER" \
  '  if (input.penArmed) return "pen";' \
  '  if (input.penArmed && !input.selectionAvailable) return "pen";'

# 4 — the ghost drops a voice.
probe "B4 ghost drops a voice" "ghost showed 2/3 voices" "$GHOST" \
  'export function penGhost(' 'export function penGhostFull(' \
  'export function penGhostFull(' 'function penGhostFull('

# 5 — a pointer-cancel writes instead of abandoning.
probe "B5 pointer-cancel writes" "the ghost changed the song" "$BAR" \
  '                    onPointerCancel={() => {
                      cancelHold();
                      onPenTarget?.(null);
                    }}' \
  '                    onPointerCancel={() => {
                      cancelHold();
                    }}'

# 6 — selection state counted as a write again.
probe "B6 selection counted as a write" "ghost line" "$EVIDENCE" \
  '  const songChanged = evidence.songBefore !== evidence.songAfter;' \
  '  const songChanged = true;'

# 7 — a song change hidden from the history and storage evidence.
probe "B7 song change hidden from history" "ghost line" "$EVIDENCE" \
  '  if (songChanged && !(historyGrew && stored)) {' '  if (false) {'

# 8 — the transition log turned back into a polling boolean.
probe "B8 play measured by polling instant" "play-pause" "$TRANSIT" \
  '  const played = log.played || nowPlaying || sample.status === "ended";' \
  '  const played = nowPlaying;'

# 9 — the loop read from the DOM instead of the engine.
probe "B9 loop read from the DOM" "loop ISSUE" "$WATCH" \
  '        loopOn: loop?.on ?? false,' \
  '        loopOn: document.querySelector("[data-loop-on]") !== null,'

# 10 — the tempo detached from the settings the transport runs at.
probe "B10 tempo detached from settings" "tempo ISSUE" "$WATCH" \
  '        /yüzde (\d+)/.exec(pill?.getAttribute("aria-label") ?? "")?.[1] ?? 100,' \
  '        100,'

# 11 — a desktop with no touch allowed to claim a physical pass.
probe "B11 desktop claims physical PASS" "desktop claimed physical" "$REPORT" \
  '    touch: device.touchPoints > 0,' '    touch: true,' \
  '    android: /Android\s+[\d.]/.test(device.userAgent),' '    android: true,'

# 12 — an unheard passage counted as answered.
probe "B12 unheard passage counted as heard" "listening" "$REPORT" \
  '  const unheard = LISTEN_KEYS.filter((key) => !observed.heard[key]);' \
  '  const unheard: ListenKey[] = [];'

echo
echo "kırmızı ${pass} · vacuous ${fail} · atlanan ${skipped}"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
