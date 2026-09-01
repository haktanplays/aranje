#!/usr/bin/env bash
# Mutation probes for the selection action canon (2V-B §13).
#
# Every mutant here is a way this round can be wrong that somebody would
# actually write — and several of them are exactly the state the code was in
# when a founder opened "Daha fazla" and found one unrelated verb behind it.
#
# The runner is stricter than "the command exited non-zero":
#
# - **Zero tests run** means the mutation broke the parser, not the guarantee.
# - **A timeout alone** says the machine was busy. It is not a finding.
# - **An equivalent mutant** cannot change behaviour, so green there is the
#   mutant's fault and not the test's. It is reported as VACUOUS, listed by
#   name, and never summed into the pass count.
#
#   ./eval/editor-2vb/probes.sh
set -u

pass=0; vacuous=0; invalid=0
declare -a VACUOUS_LIST=()
declare -a INVALID_LIST=()
LOG="${PROBE_LOG:-/tmp/aranje-2vb-probe.log}"
BUDGET="${PROBE_TIMEOUT:-300}"

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

  timeout "$BUDGET" bash -c "$cmd" > "$LOG" 2>&1
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

CANON="npx vitest run src/lib/song/selection-action-canon.test.ts"
REACH="npx vitest run src/lib/workspace/selection-reachability.test.ts"
VERBS="npx vitest run src/lib/workspace/selection-verbs.test.ts"
BATCH="npx vitest run src/lib/acceptance/batch-steps.test.ts"
ISOLATION="npx vitest run src/lib/acceptance/editor-isolation.test.ts"
EXTEND="npx vitest run src/lib/workspace/power-chord-extend.test.ts"
ALL="npx vitest run src/lib/song/selection-action-canon.test.ts src/lib/workspace/selection-reachability.test.ts src/lib/workspace/selection-verbs.test.ts"

echo "== each action placed nowhere, one at a time =="

probe "01 «copy» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "copy") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "02 «cut» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "cut") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "03 «duplicate» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "duplicate") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "04 «repeat» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "repeat") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "05 «move» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "move") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "06 «delete» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "delete") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "07 «extend» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "extend") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "08 «connect» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "connect") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "09 «paste» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "paste") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "10 «listen_once» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "listen_once") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

probe "11 «listen_loop» is placed on no surface at all" \
  src/lib/song/selection-action-canon.ts \
  '  const layout = LAYOUT[mode];
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  '  const layout = LAYOUT[mode];
  if (id === "listen_loop") return null;
  if (layout.primary.includes(id)) return PRIMARY_SURFACE[mode];' \
  "$ALL"

echo "== placement moved to the wrong surface =="

probe "12 the listening actions are moved onto the reading grid" \
  src/lib/song/selection-action-canon.ts \
  '    primary: ["copy", "cut", "duplicate", "repeat", "move", "extend", "delete", "more"],' \
  '    primary: ["copy", "cut", "duplicate", "repeat", "move", "listen_once", "listen_loop", "more"],' \
  "$ALL"

probe "13 «Devam» is demoted into the sheet" \
  src/lib/song/selection-action-canon.ts \
  '    primary: ["copy", "cut", "duplicate", "repeat", "move", "extend", "delete", "more"],
    /*' \
  '    primary: ["copy", "cut", "duplicate", "repeat", "move", "delete", "more"],
    /*' \
  "$ALL"

probe "14 the compact row grows a fifth verb" \
  src/lib/song/selection-action-canon.ts \
  '    primary: ["connect", "move", "extend", "more"],' \
  '    primary: ["connect", "move", "extend", "delete", "more"],' \
  "$ALL"

probe "15 the read sheet is given «Sil» again, beside the grid that has it" \
  src/lib/song/selection-action-canon.ts \
  '    sheet: ["paste", "listen_once", "listen_loop"],' \
  '    sheet: ["delete", "paste", "listen_once", "listen_loop"],' \
  "$ALL"

echo "== the model says available and the surface does not draw it =="

probe "16 an available capability is dropped before it can be placed" \
  src/lib/song/selection-action-canon.ts \
  '    const state = stateOf(verb);
    if (state === null || state.kind === "hidden") continue;' \
  '    const state = stateOf(verb);
    if (state === null || state.kind !== "disabled") continue;' \
  "$ALL"

probe "17 a hidden verb is drawn anyway" \
  src/lib/song/selection-action-canon.ts \
  '    if (state === null || state.kind === "hidden") continue;' \
  '    if (state === null) continue;' \
  "$CANON"

probe "18 the same action is drawn twice" \
  src/lib/song/selection-action-canon.ts \
  '  for (const id of [...layout.primary, ...layout.sheet]) {' \
  '  for (const id of [...layout.primary, ...layout.primary, ...layout.sheet]) {' \
  "$ALL"

probe "19 an action with no handler is drawn regardless" \
  src/lib/song/selection-action-canon.ts \
  '    if (!input.handlers.has(id)) continue;' \
  '' \
  "$CANON"

echo "== the handler mapping =="

probe "20 «Sil» is wired to the copy handle" \
  src/lib/workspace/selection-verbs.ts \
  '      case "delete":
        time.handle.apply({ kind: "delete_selection" });' \
  '      case "delete":
        time.handle.copy();' \
  "$REACH"

probe "21 «Kes» becomes a duplicate" \
  src/lib/workspace/selection-verbs.ts \
  '      case "cut":
        time.handle.apply({ kind: "cut_selection" });' \
  '      case "cut":
        time.handle.apply({ kind: "duplicate_selection" });' \
  "$REACH"

probe "22 «Seçimi dinle» starts the loop instead" \
  src/lib/workspace/selection-verbs.ts \
  '      case "listen_once":
        listening.audition();' \
  '      case "listen_once":
        listening.toggleLoop();' \
  "$REACH"

probe "23 «Yapıştır» is silently unhandled" \
  src/lib/workspace/selection-verbs.ts \
  '      case "paste":
        time.pasteHere();
        return;' \
  '      case "paste":
        return;' \
  "$REACH"

echo "== the surfaces stop asking the canon =="

probe "24 the read sheet goes back to a fixed pair" \
  src/components/workspace/SelectionActionArea.tsx \
  '        actions={onSurface(read, "more_sheet")}' \
  '        actions={onSurface(read, "more_sheet").filter((entry) => entry.id === "paste")}' \
  "$VERBS"

probe "25 the reading grid draws the sheet's contents instead" \
  src/components/workspace/SelectionActionArea.tsx \
  '          actions={onSurface(read, "read_primary")}' \
  '          actions={onSurface(read, "more_sheet")}' \
  "$VERBS"

probe "26 the read and edit lists are split apart again" \
  src/lib/workspace/selection-verbs.ts \
  '    handlers: input.mode === "read" ? READ_HANDLERS : EDIT_HANDLERS,' \
  '    handlers: input.mode === "read" ? new Set(["copy", "cut", "more"]) : EDIT_HANDLERS,' \
  "$ALL"

probe "27 the compact drawer stops drawing the sheet surface" \
  src/components/workspace/SelectionToolbar.tsx \
  '  const drawer = onSurface(actions.actions, "more_sheet");' \
  '  const drawer = [];' \
  "$VERBS"

probe "28 the measure bar keeps a hard-coded row again" \
  src/components/workspace/BarActionBar.tsx \
  '  const primary = onSurface(actions, "measure_primary");' \
  '  const primary = [];' \
  "$VERBS"

probe "29 the measure sheet loses its listening entries" \
  src/components/workspace/BarActionBar.tsx \
  '  const listen = onSurface(actions, "more_sheet");' \
  '  const listen = [];' \
  "$VERBS"

echo "== the capability model itself =="

probe "30 «Yapıştır» is offered on an empty clipboard" \
  src/lib/song/selection-capability.ts \
  '        if (!context.hasClipboard) {
          return disabled("Panoda bir şey yok.");
        }' \
  '        if (!context.hasClipboard) {
          return available;
        }' \
  "$ALL"

probe "31 «Yapıştır» is hidden even with a full clipboard" \
  src/lib/song/selection-capability.ts \
  '        if (context.clipboardScope !== "range") {' \
  '        if (context.clipboardScope === "range") {' \
  "$ALL"

probe "32 the power chord loses «Devam»" \
  src/lib/song/selection-capability.ts \
  '        return context.hasExtendTarget
          ? available
          : disabled(NOTHING_TO_EXTEND);' \
  '        return isChord ? hidden : available;' \
  "npx vitest run src/lib/song/selection-action-canon.test.ts src/lib/workspace/power-chord-extend.test.ts"

probe "33 the measure row's move is always live" \
  src/lib/song/selection-capability.ts \
  '      return firstBar > 0 || lastBar < context.sectionBarCount - 1
        ? available
        : disabled("Taşınacak yer yok.");' \
  '      return available;' \
  "$CANON"

probe "34 listening is refused on a run of whole bars" \
  src/lib/song/selection-capability.ts \
  '    if (LISTEN_VERBS.includes(verb)) {
      return context.hasAudibleNotes ? available : disabled(NOTHING_TO_HEAR);
    }' \
  '    if (LISTEN_VERBS.includes(verb)) {
      if (isMeasures) return hidden;
      return context.hasAudibleNotes ? available : disabled(NOTHING_TO_HEAR);
    }' \
  "$ALL"

echo "== the founder batch's own honesty =="

probe "35 a step that wrote nothing counts as a write" \
  src/lib/acceptance/batch-steps.ts \
  '    case "one_write":
      /* One new state and one commit — not two, and not a preview only. */
      return states.length === 2 && last !== first && moved === 1;' \
  '    case "one_write":
      return true;' \
  "$BATCH"

probe "36 undo is accepted without returning to the same bytes" \
  src/lib/acceptance/batch-steps.ts \
  '      return states.length >= 3 && last === first && moved >= 2;' \
  '      return states.length >= 3 && moved >= 2;' \
  "$BATCH"

probe "37 redo is accepted without restoring what undo took" \
  src/lib/acceptance/batch-steps.ts \
  '        states.length >= 4 && last !== first && last === states[1] && moved >= 3' \
  '        states.length >= 4 && last !== first && moved >= 3' \
  "$BATCH"

probe "38 a skipped step is allowed to pass" \
  src/lib/acceptance/batch-steps.ts \
  '  if (BATCH_STEPS.some((step) => environment.measured[step.id] == null)) return "PARTIAL";' \
  '' \
  "$BATCH"

probe "39 a desktop is allowed a physical PASS" \
  src/lib/acceptance/batch-steps.ts \
  '  if (environment.touchPoints === 0) return "PARTIAL";' \
  '' \
  "$BATCH"

probe "40 a measured breakage is outranked by a good answer" \
  src/lib/acceptance/batch-steps.ts \
  '  if (BATCH_STEPS.some((step) => environment.measured[step.id] === false)) return "FAIL";' \
  '' \
  "$BATCH"

probe "41 the guide grows a thirteenth step" \
  src/lib/acceptance/batch-steps.ts \
  '  {
    id: "finish",
    title: "12 · Sonuç",' \
  '  {
    id: "finish",
    title: "13 · Fazladan",
    task: "Fazladan bir şey yap.",
    watchFor: "",
    expect: { kind: "no_write" },
    questions: [],
  },
  {
    id: "finish",
    title: "12 · Sonuç",' \
  "$BATCH"

probe "42 a step stops naming the control it asks for" \
  src/lib/acceptance/batch-steps.ts \
  '    task: "Birkaç notaya basılı tutup sağa sürükle, sonra «Daha fazla»ya dokun.",' \
  '    task: "Bir yerlere dokun.",' \
  "$BATCH"

probe "43 the block claims something about how it sounded" \
  src/lib/acceptance/batch-report.ts \
  '    "ARANJÉ · Editör eylem kabulü (2V-B)",' \
  '    "ARANJÉ · Editör eylem kabulü (2V-B) — ses kalitesi yükseldi",' \
  "$BATCH"

echo "== the route's isolation =="

probe "44 the batched route is left indexable" \
  src/app/eval/editor-action-batch/page.tsx \
  '  robots: { index: false, follow: false },' \
  '' \
  "$ISOLATION"

probe "45 the route grows a test button that plays for the reader" \
  src/components/acceptance/EditorActionBatch.tsx \
  '            <Big testId="restart" tone="plain" onClick={() => setScreen(0)}>' \
  '            <button type="button" onClick={() => {}}>Seçimi dinle</button>
            <Big testId="restart" tone="plain" onClick={() => setScreen(0)}>' \
  "$ISOLATION"

probe "46 the route writes to the store it is meant to only read" \
  src/components/acceptance/EditorActionBatch.tsx \
  '    const reading = readFixture(session?.storage ?? EMPTY_STORAGE);' \
  '    (session?.storage ?? EMPTY_STORAGE).setItem("x", "y");
    const reading = readFixture(session?.storage ?? EMPTY_STORAGE);' \
  "$ISOLATION"

probe "47 the exact-build gate is removed" \
  src/components/acceptance/EditorActionBatch.tsx \
  '  if (!mayStart(gate)) {' \
  '  if (false) {' \
  "$ISOLATION"

echo "== geometry and the sheet's own behaviour =="

probe "48 the touch target constant is shrunk on the reading grid" \
  src/components/workspace/SelectionActionBar.tsx \
  '                minHeight: MIN_TOUCH_TARGET_PX,
                minWidth: MIN_TOUCH_TARGET_PX,' \
  '                minHeight: 32,
                minWidth: 32,' \
  "$EXTEND"

probe "49 the grid is given a third row" \
  src/components/workspace/SelectionActionBar.tsx \
  '      <div className="grid grid-cols-4 gap-1 p-2">' \
  '      <div className="grid grid-cols-3 gap-1 p-2">' \
  "$EXTEND"

probe "50 the sheet closes itself behind the sheet it just opened" \
  src/lib/song/selection-action-canon.ts \
  'const OPENS_SHEET: readonly SelectionActionId[] = ["move", "repeat", "paste", "more"];' \
  'const OPENS_SHEET: readonly SelectionActionId[] = [];' \
  "$CANON"

probe "51 the disabled reason is dropped from the control" \
  src/lib/song/selection-action-canon.ts \
  '        ? { availability: "disabled" as const, reason: state.reason }' \
  '        ? { availability: "disabled" as const }' \
  "$ALL"

probe "52 a disabled action is reported as available" \
  src/lib/song/selection-action-canon.ts \
  '      ...(state.kind === "disabled"' \
  '      ...(false' \
  "$ALL"

echo
echo "-----------------------------------------------------------------"
echo "RED (a named test failed for the right reason): $pass"
echo "VACUOUS (mutant changed nothing observable):    $vacuous"
echo "INVALID (no test ran, or a timeout):            $invalid"
for entry in ${VACUOUS_LIST+"${VACUOUS_LIST[@]}"}; do echo "  vacuous: $entry"; done
for entry in ${INVALID_LIST+"${INVALID_LIST[@]}"}; do echo "  invalid: $entry"; done
[ "$vacuous" -eq 0 ] && [ "$invalid" -eq 0 ] || exit 1
