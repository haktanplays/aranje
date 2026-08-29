#!/usr/bin/env bash
# Mutation probes for the six live FAILs (2U-B §13).
#
# Each probe re-introduces one of the defects the founder found — or one of
# the ways this round's tests could have been written to miss it — and asserts
# that a named test goes red for the right reason. The runner is the 2U-A one
# and is stricter than "the command exited non-zero", for the three reasons
# §13 names:
#
# - **Zero tests run.** A mutation that breaks the parser exits non-zero having
#   asserted nothing. Counting that as RED credits a probe for a syntax error.
# - **A timeout alone.** A hung run says the machine was busy.
# - **An equivalent mutant.** A change that cannot alter behaviour stays green,
#   and reading that as "the test is vacuous" would be backwards — so green is
#   reported as VACUOUS, listed by name, and never summed away.
#
#   ./eval/editor-2ub/probes.sh
set -u

pass=0; vacuous=0; invalid=0
declare -a VACUOUS_LIST=()
declare -a INVALID_LIST=()
LOG="${PROBE_LOG:-/tmp/aranje-2ub-probe.log}"

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

VERBS="npx vitest run src/lib/workspace/selection-verbs.test.ts"
CAP="npx vitest run src/lib/song/selection-capability.test.ts"
MENU="npx vitest run src/lib/song/bar-menu.test.ts"
BAR="npx vitest run src/lib/song/bar-transform.test.ts"
DRAG="npx vitest run src/lib/ui/bar-range-drag.test.ts"
PHASE="npx vitest run src/lib/acceptance/editor-phase.test.ts"
REPORT="npx vitest run src/lib/acceptance/editor-report.test.ts"
FIXTURE="npx vitest run src/lib/acceptance/editor-fixture.test.ts"
OWNER="npx vitest run src/lib/tab/pointer-ownership.test.ts src/lib/ui/bar-range-drag.test.ts"

echo "== §3 the clipboard =="

probe "01 the clipboard is forgotten when the selection changes" \
  src/lib/workspace/selection-verbs.ts \
  '          hasClipboard: time.handle.hasClipboard,' \
  '          hasClipboard: false,' \
  "$VERBS"

probe "02 paste is hidden on an empty selection" \
  src/lib/song/selection-capability.ts \
  '      if (verb === "paste") {
        if (isMeasures) return hidden;' \
  '      if (verb === "paste") {
        if (isMeasures || empty) return hidden;' \
  "$VERBS"

probe "03 paste has no surface to be drawn on" \
  src/lib/workspace/selection-verbs.ts \
  '  { key: "onPaste", verb: "paste" },' \
  '' \
  "$VERBS"

probe "04 pasting writes during the preview" \
  src/lib/acceptance/editor-steps.ts \
  '        id: "pasteCancelled",
        text: "«Daha fazla» → «Yapıştır». Önizlemeyi gör ve vazgeç.",
        expect: { kind: "no_write" },' \
  '        id: "pasteCancelled",
        text: "«Daha fazla» → «Yapıştır». Önizlemeyi gör ve vazgeç.",
        expect: { kind: "free" },' \
  "$PHASE"

probe "05 a paste is allowed to take two history steps" \
  src/lib/acceptance/editor-steps.ts \
  '    case "one_write":
      return changed && revisionMoved === 1;' \
  '    case "one_write":
      return changed && revisionMoved >= 1;' \
  "$PHASE"

echo
echo "== §4 undo/redo tied to the paste =="

probe "06 undo/redo passes although the paste never applied" \
  src/lib/acceptance/editor-steps.ts \
  '  return (phase.requires ?? []).filter((key) => checks[key] !== true);' \
  '  return [];' \
  "$PHASE"

probe "07 a dependency nobody checked counts as satisfied" \
  src/lib/acceptance/editor-steps.ts \
  '  return (phase.requires ?? []).filter((key) => checks[key] !== true);' \
  '  return (phase.requires ?? []).filter((key) => checks[key] === false);' \
  "$PHASE"

probe "08 the two history marks may be the same song" \
  src/lib/acceptance/editor-steps.ts \
  '      const other = diff.marks[expect.distinctFrom];
      return other !== undefined && other !== remembered;' \
  '      return true;' \
  "$PHASE"

echo
echo "== §5 moving between strings =="

probe "09 the string-move step points back at the unplayable motif" \
  src/lib/acceptance/editor-fixture.ts \
  '  restringBar: 2,' \
  '  restringBar: 0,' \
  "$FIXTURE"

probe "10 the playability refusal is removed" \
  src/lib/song/transform.ts \
  '        const fret = fretFor(fretboard, to, midi);
        if (fret === null) {' \
  '        const fret = fretFor(fretboard, to, midi) ?? 0;
        if (false) {' \
  "$FIXTURE"

probe "11 an unplayable selection is left with no negative step" \
  src/lib/acceptance/editor-fixture.ts \
  '  unplayableRestring: { barIndex: 0, slotIndex: 0 },' \
  '  unplayableRestring: { barIndex: 2, slotIndex: 0 },' \
  "$FIXTURE"

echo
echo "== §6 the three scopes =="

probe "12 a track-scope bar is offered “Ölçü ekle”" \
  src/lib/song/bar-menu.ts \
  '    ...(full
      ? [
          { action: "blank_before" as const, label: "Önüne ölçü ekle" },
          { action: "blank_after" as const, label: "Arkasına ölçü ekle" },
        ]
      : []),' \
  '    { action: "blank_before" as const, label: "Önüne ölçü ekle" },
    { action: "blank_after" as const, label: "Arkasına ölçü ekle" },' \
  "$MENU"

probe "13 the whole-measure scope is guessed from the track count" \
  src/lib/song/selection-descriptor.ts \
  '    barScope: selection.scope,' \
  '    barScope: song.tracks.length > 1 ? "full" : "track",' \
  "npx vitest run src/lib/song/measure-spine.test.ts"

probe "14 the measure dialog is left empty" \
  src/lib/song/bar-menu.ts \
  '  return barMoreEntries(scope, canPaste).length > 0;' \
  '  return true;' \
  "$MENU"

probe "15 a bar-adding verb is offered to one instrument" \
  src/lib/song/selection-capability.ts \
  '  "insert_bar_before",
  "insert_bar_after",
];' \
  '];' \
  "$CAP"

echo
echo "== §7 “Yerine koy” =="

probe "16 “Yerine koy” is a no-op again" \
  src/lib/song/bar-transform.ts \
  '    case "paste_bar_contents":
    case "duplicate_bars":
    case "repeat_bars":
      return { ...command, replace: true };' \
  '    case "paste_bar_contents":
      return { ...command, replace: true };' \
  "$BAR"

probe "17 a blocked move is offered an overwrite that cannot work" \
  src/lib/song/bar-transform.ts \
  '            "move_target_occupied",
            "Taşınacak yerde bu enstrümanın içeriği var.",' \
  '            "target_occupied",
            "Taşınacak yerde bu enstrümanın içeriği var.",' \
  "$BAR"

probe "18 a confirmed overwrite half-applies" \
  src/lib/song/bar-transform.ts \
  '  if (
    !replace &&
    trackRangeHasContent(section, selection.trackId, at, at + length * times - 1)
  ) {' \
  '  if (
    trackRangeHasContent(section, selection.trackId, at, at + length * times - 1)
  ) {' \
  "$BAR"

echo
echo "== §8 who owns the pointer =="

probe "19 the long press never takes the pointer" \
  src/lib/ui/bar-range-drag.ts \
  '  if (state.kind !== "pressing" || state.pointerId !== pointerId) return state;
  return {
    kind: "owning",' \
  '  if (true) return state;
  return {
    kind: "owning",' \
  "$DRAG"

probe "20 the page is allowed to scroll under the drag" \
  src/lib/tab/pointer-ownership.ts \
  '  return owner === "duration" || owner === "bar_range";' \
  '  return owner === "duration";' \
  "$OWNER"

probe "21 a global touch-action:none replaces the ownership" \
  src/lib/tab/pointer-ownership.ts \
  '  if (input.barRangeOwning === true) return "bar_range";' \
  '  if (false) return "bar_range";' \
  "$OWNER"

probe "22 pointercancel no longer cleans up" \
  src/lib/ui/bar-range-drag.ts \
  'export function releaseDrag(): BarRangeDrag {
  return IDLE;
}' \
  'export function releaseDrag(): BarRangeDrag {
  return { kind: "owning", pointerId: 1, anchorBar: 0, reachBar: 0, sectionId: "s1" };
}' \
  "$DRAG"

probe "23 a wandering finger still becomes a selection" \
  src/lib/ui/bar-range-drag.ts \
  '    return wandered ? IDLE : state;' \
  '    return state;' \
  "$DRAG"

probe "24 the reach may cross into another section" \
  src/lib/ui/bar-range-drag.ts \
  '  if (barUnderPointer.sectionId !== state.sectionId) return state;' \
  '  if (false) return state;' \
  "$DRAG"

echo
echo "== §9 what a two-bar run must prove =="

probe "25 only the last bar is selected instead of the run" \
  src/lib/ui/bar-range-drag.ts \
  '    startBarIndex: Math.min(state.anchorBar, state.reachBar),
    endBarIndex: Math.max(state.anchorBar, state.reachBar),' \
  '    startBarIndex: state.reachBar,
    endBarIndex: state.reachBar,' \
  "$DRAG"

probe "26 dragging back no longer shrinks the run" \
  src/lib/ui/bar-range-drag.ts \
  '  return barUnderPointer.barIndex === state.reachBar
    ? state
    : { ...state, reachBar: barUnderPointer.barIndex };' \
  '  return barUnderPointer.barIndex <= state.reachBar
    ? state
    : { ...state, reachBar: barUnderPointer.barIndex };' \
  "$DRAG"

probe "27 the multi-measure work is not tied to two bars being held" \
  src/lib/acceptance/editor-steps.ts \
  '        expect: { kind: "one_write" },
        requires: ["multiSelectedByDrag"],' \
  '        expect: { kind: "one_write" },' \
  "$PHASE"

probe "28 a multi-repeat is allowed two history steps" \
  src/lib/song/bar-transform.ts \
  '  let bars: readonly Bar[] = section.bars;
  for (let round = 0; round < times; round += 1) {' \
  '  let bars: readonly Bar[] = section.bars;
  for (let round = 0; round < times + 1; round += 1) {' \
  "$BAR"

echo
echo "== §10 §11 what the report may claim =="

probe "29 the note/measure distinction is left unmeasured" \
  src/lib/acceptance/editor-report.ts \
  '      "trackBarHidesInsert",
      "wholeMeasureRunsInsert",' \
  '' \
  "$REPORT"

probe "30 a run where nothing was done is written up as a pass" \
  src/lib/acceptance/editor-report.ts \
  '  if (verdicts.includes("pending")) return "PARTIAL";' \
  '  if (false) return "PARTIAL";' \
  "$REPORT"

probe "31 a clean automated run is signed off as a founder pass" \
  src/lib/acceptance/editor-report.ts \
  '    "Founder verdict: Haktan doldurmadı",' \
  '    verdict === "PASS" ? "Founder verdict: PASS" : "Founder verdict: Haktan doldurmadı",' \
  "$REPORT"

probe "32 an offered verb needs no surface to draw it" \
  src/lib/workspace/selection-verbs.ts \
  '  { key: "onCut", verb: "cut" },' \
  '' \
  "$VERBS"

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
