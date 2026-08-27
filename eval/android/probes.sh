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
#
# `ONLY=B5,B7` runs just those, so a probe that needed correcting can be
# re-checked without sitting through eleven rebuilds.
probe() {
  local name="$1" expect="$2" file="$3"; shift 3
  if [ -n "${ONLY:-}" ] && ! printf '%s' ",${ONLY}," | grep -q ",${name%% *},"; then
    return
  fi
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
RIFF=src/lib/acceptance/riff.ts
COMPOSER=src/lib/workspace/use-intent-composer.ts

# 1 — the route opens where the live run found it: on the arrangement.
probe "B1 route starts on Düzen" "route did not open on the tab" "$GROUND" \
  '    it.navigation.showTab();' '    void it.navigation;'

# 2 — steps stop cleaning up after themselves. The harness deliberately walks
# out of the selection step with a selection still open, so the mess is real.
probe "B2 no cleanup between steps" "the next step inherited a selection" "$GROUND" \
  '    it.overlays.close();
    it.resetEditSurfaces();' '    it.overlays.close();'

# 3 — the pen stops owning the press, so both gestures run again.
probe "B3 long press wins over the pen" "a time selection opened under the pen" "$OWNER" \
  '  if (input.penArmed) return "pen";' \
  '  if (input.penArmed && !input.selectionAvailable) return "pen";'

# 4 — the ghost drops a voice: the pen is armed with two instead of three.
probe "B4 ghost drops a voice" "ghost showed 2/3 voices" "$GROUND" \
  'const POWER_PEN: ComposerTool = { kind: "power_chord", voices: 3, fret: 5 };' \
  'const POWER_PEN: ComposerTool = { kind: "power_chord", voices: 2, fret: 5 };'

# 5 — a cancelled press keeps its preview on screen instead of abandoning it.
probe "B5 an abandoned press keeps its ghost" "a cancelled press left its ghost behind" "$BAR" \
  '                    onPointerLeave={() => {
                      cancelHold();
                      onPenTarget?.(null);
                    }}' \
  '                    onPointerLeave={() => {
                      cancelHold();
                    }}' \
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

# 7 — the preview stops being a preview: the pen writes on the press.
#
# The first version of this probe disabled the inconsistency branch, and that
# branch is unreachable in a run where nothing writes — a mutation nothing can
# execute proves nothing. This one makes a real write happen instead.
# The preview stops being a preview: drawing the ghost commits it.
#
# Two earlier attempts were rejected rather than kept. Writing on every
# pointer-down tripped the selection step before the ghost window opened, and
# writing on every pointer-leave changed the layout so violently that the
# harness timed out — a crash is a red exit, not a finding. This one writes
# exactly where the ghost is drawn, which is exactly where the guarantee is.
probe "B7 the preview commits itself" "the guided run changed the song" "$COMPOSER" \
  '      const result = runPen(target, "insert") ?? runPen(target, "replace_onset");
      return result && result.ok ? result.song : null;' \
  '      const result = runPen(target, "insert") ?? runPen(target, "replace_onset");
      if (result && result.ok) commit(result.song, { kind: "note_edit" });
      return result && result.ok ? result.song : null;'

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

# 12 — a passage the playhead never reaches, answered anyway.
#
# Moving the listening windows out of the riff's reach is the honest form of
# this: the reader still answers "Net duydum" six times, the playhead still
# never crosses any of them, and the block must refuse a listening pass and
# say "bu bölüm çalınmadı". Blanking the unheard list was the first attempt
# and changed nothing, because in a clean run there is nothing to blank.
probe "B12 unheard passage counted as heard" "listening PARTIAL" "$RIFF" \
  'export const LISTEN_WINDOWS' 'const REAL_LISTEN_WINDOWS' \
  'export const ACCEPTANCE_TRACK' 'export const LISTEN_WINDOWS = Object.fromEntries(
  Object.keys(REAL_LISTEN_WINDOWS).map((key) => [key, { from: 99000, to: 99001 }]),
) as typeof REAL_LISTEN_WINDOWS;

export const ACCEPTANCE_TRACK'

echo
echo "kırmızı ${pass} · vacuous ${fail} · atlanan ${skipped}"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
