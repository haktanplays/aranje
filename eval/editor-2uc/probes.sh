#!/usr/bin/env bash
# Mutation probes for the gesture ownership round (2U-C §8).
#
# Each probe re-introduces one of the ways this gesture can fail — including
# every defect measured during this round — and asserts that a named test goes
# red for the right reason. Six of them are the state the code was actually in
# at some point today; the rest are the ways the tests could have been written
# to miss them.
#
# The runner is stricter than "the command exited non-zero", for three reasons
# §8 names:
#
# - **Zero tests run.** A mutation that breaks the parser exits non-zero having
#   asserted nothing. Counting that as RED credits a probe for a syntax error.
# - **A timeout alone.** A hung run says the machine was busy.
# - **An equivalent mutant.** A change that cannot alter behaviour stays green,
#   and reading that as "the test is vacuous" would be backwards — so green is
#   reported as VACUOUS, listed by name, and never summed away.
#
#   ./eval/editor-2uc/probes.sh
set -u

pass=0; vacuous=0; invalid=0
declare -a VACUOUS_LIST=()
declare -a INVALID_LIST=()
LOG="${PROBE_LOG:-/tmp/aranje-2uc-probe.log}"

probe() {
  local name="$1" file="$2" find="$3" repl="$4" cmd="$5"
  cp "$file" "$file.probebak"
  python3 - "$file" "$find" "$repl" <<'PY'
import io,sys
p,f,r=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding="utf-8").read()
if f not in s:
    sys.stderr.write("ANCHOR MISSING: "+f[:70]+"\n"); sys.exit(2)
io.open(p,"w",encoding="utf-8").write(s.replace(f,r,1))
PY
  if [ $? -ne 0 ]; then
    echo "INVALID $name (anchor missing)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: anchor missing")
    mv "$file.probebak" "$file"; return
  fi

  timeout 120 bash -c "$cmd" > "$LOG" 2>&1
  local code=$?
  mv "$file.probebak" "$file"

  if [ $code -eq 124 ]; then
    echo "INVALID $name (timed out — a hang is not evidence)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: timeout")
    return
  fi

  local total failed
  total=$(grep -oE 'Tests +[0-9|a-z ]*\(([0-9]+)\)' "$LOG" | grep -oE '\(([0-9]+)\)$' | tr -d '()' | tail -1)
  failed=$(grep -oE 'Tests +([0-9]+) failed' "$LOG" | grep -oE '[0-9]+' | tail -1)
  total=${total:-0}; failed=${failed:-0}

  if [ "$total" -eq 0 ]; then
    echo "INVALID $name (no test ran — the mutation broke the build, not the guarantee)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: zero tests run")
    return
  fi
  if [ "$failed" -gt 0 ]; then
    echo "RED     $name  ($failed of $total)"; pass=$((pass+1))
  else
    echo "GREEN   $name  <-- VACUOUS ($total ran, none failed)"
    vacuous=$((vacuous+1)); VACUOUS_LIST+=("$name")
  fi
}

OWNER="npx vitest run src/lib/tab/pointer-ownership.test.ts"
DRAG="npx vitest run src/lib/ui/press-drag.test.ts"
COSTS="npx vitest run src/lib/ui/drag-ownership.test.ts"
WIRING="npx vitest run src/lib/ui/interaction-boundary.test.ts"
CLICK="npx vitest run src/lib/ui/swallow-click.test.ts"
RANGE="npx vitest run src/lib/ui/bar-range-drag.test.ts"

echo "== §1 what the page promises before the finger lands =="

probe "01 the bar header hands the horizontal pan back to the compositor" \
  src/lib/tab/pointer-ownership.ts \
  'return owner === "measure" || owner === "bar_range" ? "pan-y" : "auto";' \
  'return owner === "measure" || owner === "bar_range" ? "pan-x" : "auto";' \
  "$OWNER"

probe "02 the header declares nothing at all" \
  src/lib/tab/pointer-ownership.ts \
  'return owner === "measure" || owner === "bar_range" ? "pan-y" : "auto";' \
  'return "auto";' \
  "$OWNER"

probe "03 touch-action: none goes on the whole staff instead" \
  src/lib/tab/pointer-ownership.ts \
  'return owner === "measure" || owner === "bar_range" ? "pan-y" : "auto";' \
  'return "none";' \
  "$OWNER"

probe "04 a bar block writes its own axis instead of asking" \
  src/components/workspace/FrettedBarBlock.tsx \
  'touchAction: declaredTouchAction(headerOwner),' \
  'touchAction: "pan-y",' \
  "$WIRING"

probe "05 the note range claims a promise it cannot make" \
  src/lib/tab/pointer-ownership.ts \
  'if (owner === "duration") return "none";' \
  'if (owner === "duration") return "none";
  if (owner === "note_range") return "pan-y";' \
  "$OWNER"

echo
echo "== §2 what owning a drag costs the page =="

probe "06 the scroll suppression is armed only after the gesture began" \
  src/lib/ui/drag-ownership.ts \
  '      document.removeEventListener("selectstart", block);
    };
  }, []);' \
  '      document.removeEventListener("selectstart", block);
    };
  }, [owning]);' \
  "$COSTS"

probe "07 the browser keeps its native drag" \
  src/lib/ui/drag-ownership.ts \
  '    document.addEventListener("dragstart", block);' \
  '' \
  "$COSTS"

probe "08 nothing stops the page scrolling under a held range" \
  src/lib/tab/pointer-ownership.ts \
  'owner === "duration" || owner === "bar_range" || owner === "note_range"' \
  'owner === "duration"' \
  "$OWNER"

probe "09 pointer capture is taken before the reader has chosen" \
  src/lib/ui/press-drag.ts \
  'if (state.kind !== "pressing" || state.pointerId !== pointerId) return state;' \
  'if (state.kind === "idle") return state;' \
  "$DRAG"

probe "10 a finger that wandered still opens a selection" \
  src/lib/ui/press-drag.ts \
  '  if (state.kind !== "pressing") return false;' \
  '  return false;
  if (state.kind !== "pressing") return false;' \
  "$DRAG"

probe "11 the click a finished drag leaves behind still seeks" \
  src/lib/ui/use-bar-range-drag.ts \
  'if (release()) swallowNextClick();' \
  'release();' \
  "$WIRING"

probe "12 the swallowed click is never given back" \
  src/lib/ui/swallow-click.ts \
  '  setTimeout(() => {
    target.removeEventListener("click", stop, { capture: true });
  }, CLICK_AFTER_PRESS_MS);' \
  '' \
  "$CLICK"

probe "13 a cancelled drag is treated as a finished one" \
  src/lib/ui/use-note-range-drag.ts \
  '    onPointerCancel: abandon,' \
  '    onPointerCancel: finish,' \
  "$COSTS"

probe "14 a cancelled bar drag keeps the bars nobody chose" \
  src/lib/workspace/use-selection-session.ts \
  '    onCancel: clearBars,' \
  '' \
  "$WIRING"

echo
echo "== §3 one gesture, one owner =="

probe "15 a recognised note range loses its own pointer" \
  src/lib/tab/pointer-ownership.ts \
  '  if (input.noteRangeOwning === true) return "note_range";' \
  '' \
  "$OWNER"

probe "16 an armed pen and the note range run together" \
  src/components/workspace/TabCanvas.tsx \
  'const staffPress = noteRange && owner !== "pen" ? noteRange.handlers : null;' \
  'const staffPress = noteRange ? noteRange.handlers : null;' \
  "$WIRING"

probe "17 the duration handle loses its outright win" \
  src/lib/tab/pointer-ownership.ts \
  '  if (input.onDurationHandle === true) return "duration";' \
  '' \
  "$OWNER"

probe "18 the reach runs even when the press opened nothing" \
  src/lib/workspace/use-selection-session.ts \
  '      if (!rangeLive.current) return;' \
  '' \
  "$WIRING"

echo
echo "== §4 following the finger, and letting go =="

probe "19 the edge follow hands back a new object every render" \
  src/lib/ui/drag-ownership.ts \
  'return useMemo(() => ({ attach, track, stop }), [attach, stop, track]);' \
  'return { attach, track, stop };' \
  "$COSTS"

probe "20 the teardown effect runs on every render" \
  src/lib/ui/use-note-range-drag.ts \
  '  useEffect(() => () => void teardown.current(), []);' \
  '  useEffect(() => () => void release(), [release]);' \
  "$COSTS"

probe "21 the gesture can miss its own ending" \
  src/lib/ui/use-bar-range-drag.ts \
  '  useGestureEnd(owning, { onUp: finish, onCancel: abandon });' \
  '' \
  "$COSTS"

probe "22 the edge band is measured from the viewport" \
  src/lib/ui/drag-ownership.ts \
  '  if (x < left + EDGE_BAND_PX) return -1;' \
  '  if (x < EDGE_BAND_PX) return -1;' \
  "$COSTS"

probe "23 the stationary finger is never re-read" \
  src/lib/ui/drag-ownership.ts \
  '  node.scrollLeft += direction * EDGE_STEP_PX;
  onTick(point.x, point.y);' \
  '  node.scrollLeft += direction * EDGE_STEP_PX;' \
  "$COSTS"

probe "31 the follow keeps ticking after the finger leaves the band" \
  src/lib/ui/drag-ownership.ts \
  '  if (direction === 0) return false;' \
  '  if (direction === 0) return true;' \
  "$COSTS"

probe "24 the view races past the bar the reader meant" \
  src/lib/ui/drag-ownership.ts \
  'export const EDGE_STEP_PX = 12;' \
  'export const EDGE_STEP_PX = 90;' \
  "$COSTS"

echo
echo "== §5 the range itself =="

probe "25 the run only ever grows" \
  src/lib/ui/bar-range-drag.ts \
  '    startBarIndex: Math.min(state.held.anchorBar, state.held.reachBar),
    endBarIndex: Math.max(state.held.anchorBar, state.held.reachBar),' \
  '    startBarIndex: state.held.anchorBar,
    endBarIndex: Math.max(state.held.anchorBar, state.held.reachBar),' \
  "$RANGE"

probe "26 jitter inside one bar counts as a new reach" \
  src/lib/ui/bar-range-drag.ts \
  '  return barUnderPointer.barIndex === state.held.reachBar
    ? state
    : holding(state, { ...state.held, reachBar: barUnderPointer.barIndex });' \
  '  return holding(state, { ...state.held, reachBar: barUnderPointer.barIndex });' \
  "$RANGE"

probe "27 the reach wanders into the next section" \
  src/lib/ui/bar-range-drag.ts \
  '  if (barUnderPointer.sectionId !== state.held.sectionId) return state;' \
  '' \
  "$RANGE"

probe "28 a second finger drives the first one's gesture" \
  src/lib/ui/bar-range-drag.ts \
  '  if (state.kind === "idle" || state.pointerId !== pointerId) return state;' \
  '  if (state.kind === "idle") return state;' \
  "$RANGE"

echo
echo "== §8 the report's own honesty =="

probe "29 the harness calls a browser emulation a physical pass" \
  eval/editor-2uc/verify.mjs \
  'kind: "browser emulation — not a physical device",' \
  'kind: "physical PASS",' \
  "npx vitest run eval/editor-2uc/honesty.test.ts"

probe "30 the physical step is written up as already done" \
  eval/editor-2uc/HANDOFF.md \
  'Bu adım henüz yapılmadı.' \
  'Bu adım yapıldı ve geçti.' \
  "npx vitest run eval/editor-2uc/honesty.test.ts"

echo
echo "---------------------------------------------------------------"
echo "red: $pass   vacuous: $vacuous   invalid: $invalid"
if [ ${#VACUOUS_LIST[@]} -gt 0 ]; then
  echo "VACUOUS (a mutation the tests did not notice):"
  for entry in "${VACUOUS_LIST[@]}"; do echo "  - $entry"; done
fi
if [ ${#INVALID_LIST[@]} -gt 0 ]; then
  echo "INVALID (not evidence either way):"
  for entry in "${INVALID_LIST[@]}"; do echo "  - $entry"; done
fi
[ "$vacuous" -eq 0 ] && [ "$invalid" -eq 0 ]
