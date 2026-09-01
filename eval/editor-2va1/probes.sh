#!/usr/bin/env bash
# Mutation probes for the live "Devam" FAIL and the listening route (2V-A.1 §12).
#
# Every mutant here is a way this round can be wrong that somebody would
# actually write — and several of them are the state the code was genuinely in
# when a founder pressed where "Devam" should have been.
#
# The runner is stricter than "the command exited non-zero":
#
# - **Zero tests run** means the mutation broke the parser, not the guarantee.
# - **A timeout alone** says the machine was busy. It is not a finding.
# - **An equivalent mutant** cannot change behaviour, so green there is the
#   mutant's fault and not the test's. It is reported as VACUOUS, listed by
#   name, and never summed into the pass count.
#
#   ./eval/editor-2va1/probes.sh
set -u

pass=0; vacuous=0; invalid=0
declare -a VACUOUS_LIST=()
declare -a INVALID_LIST=()
LOG="${PROBE_LOG:-/tmp/aranje-2va1-probe.log}"
BUDGET="${PROBE_TIMEOUT:-240}"

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

EXTEND="npx vitest run src/lib/workspace/power-chord-extend.test.ts"
CAPS="npx vitest run src/lib/song/selection-capability.test.ts src/lib/workspace/selection-listening.test.ts src/lib/workspace/power-chord-extend.test.ts"
PHASE="npx vitest run src/lib/acceptance/editor-phase.test.ts"
GUIDE="npx vitest run src/lib/acceptance/listening-steps.test.ts"
ISOLATION="npx vitest run src/lib/acceptance/editor-isolation.test.ts"
VERBS="npx vitest run src/lib/workspace/selection-verbs.test.ts src/lib/workspace/power-chord-extend.test.ts"

echo "== the capability half of the live FAIL =="

probe "01 the power chord loses its «Devam» capability" \
  src/lib/song/selection-capability.ts \
  '        return context.hasExtendTarget
          ? available
          : disabled(NOTHING_TO_EXTEND);' \
  '        return isChord ? hidden : available;' \
  "$CAPS"

probe "02 «Devam» is hidden from every range" \
  src/lib/song/selection-capability.ts \
  '        return context.hasExtendTarget
          ? available
          : disabled(NOTHING_TO_EXTEND);' \
  '        return hidden;' \
  "$CAPS"

probe "03 «Devam» is greyed on every selection" \
  src/lib/song/selection-capability.ts \
  '        return context.hasExtendTarget
          ? available
          : disabled(NOTHING_TO_EXTEND);' \
  '        return disabled(NOTHING_TO_EXTEND);' \
  "$CAPS"

probe "04 the reach is offered where there is nowhere to go" \
  src/lib/song/selection-extend.ts \
  '  return reachable.length > 1;' \
  '  return true;' \
  "$EXTEND"

probe "05 the reach is refused wherever the selection has notes in it" \
  src/lib/song/selection-capability.ts \
  '      if (verb === "extend") {' \
  '      if (verb === "extend" && !empty) {' \
  "$CAPS"

probe "06 the refusal speaks the core vocabulary instead of the readers" \
  src/lib/song/selection-extend.ts \
  'export const NOTHING_TO_EXTEND = "Uzatılacak yer kalmadı.";' \
  'export const NOTHING_TO_EXTEND = "extend: no target slot in scope.";' \
  "$EXTEND"

echo
echo "== the surface the founder was looking at =="

probe "07 the reading surface bar loses «Devam» again" \
  src/components/workspace/SelectionActionBar.tsx \
  '  { action: "extend", label: "Devam", verb: "extend" },' \
  '' \
  "$EXTEND"

probe "08 «Devam» is moved behind «Daha fazla»" \
  src/components/workspace/SelectionActionBar.tsx \
  '  { action: "extend", label: "Devam", verb: "extend" },
  { action: "delete", label: "Sil", verb: "delete" },
  { action: "more", label: "Daha fazla", verb: null },' \
  '  { action: "delete", label: "Sil", verb: "delete" },
  { action: "more", label: "Daha fazla", verb: null },
  { action: "extend", label: "Devam", verb: "extend" },' \
  "$EXTEND"

probe "09 the grid drops to three columns, making a third row" \
  src/components/workspace/SelectionActionBar.tsx \
  'className="grid grid-cols-4 gap-1 p-2"' \
  'className="grid grid-cols-3 gap-1 p-2"' \
  "$EXTEND"

probe "10 the bar decides for itself instead of asking the model" \
  src/components/workspace/SelectionActionBar.tsx \
  'import type { SelectionVerb, VerbOffer } from "@/lib/song/selection-capability";' \
  'type SelectionVerb = string;
type VerbOffer = { verb: string; state: { kind: string; reason?: string } };' \
  "$EXTEND"

probe "11 the target shrinks below a finger" \
  src/components/workspace/SelectionActionBar.tsx \
  '              style={{
                minHeight: MIN_TOUCH_TARGET_PX,
                minWidth: MIN_TOUCH_TARGET_PX,
              }}' \
  '              style={{ minHeight: 30, minWidth: 30 }}' \
  "$EXTEND"

probe "12 the accessible name stops being the verb" \
  src/components/workspace/SelectionActionBar.tsx \
  '              aria-label={off ? `${entry.label} — ${state.reason}` : entry.label}' \
  '              aria-label={`selection-action-${entry.action}`}' \
  "$EXTEND"

echo
echo "== the handler, and where it reaches =="

probe "13 pressing «Devam» does nothing at all" \
  src/components/workspace/SelectionActionArea.tsx \
  '              time.toggleExtend();' \
  '              void 0;' \
  "$EXTEND"

probe "14 it is wired to the wrong core" \
  src/components/workspace/SelectionActionArea.tsx \
  '              time.toggleExtend();' \
  '              time.openSheet("move");' \
  "$EXTEND"

probe "15 the reach moves the near edge instead of the far one" \
  src/lib/workspace/use-selection-session.ts \
  '        moveEdge("end", x);' \
  '        moveEdge("start", x);' \
  "$EXTEND"

probe "16 the reach writes to the song on its way past" \
  src/lib/workspace/use-selection-session.ts \
  '      transform.select(next);' \
  '      transform.select(next);
      commit(song, { kind: "note_edit" });' \
  "$EXTEND"

probe "17 the two bars stop asking the same question" \
  src/lib/workspace/selection-verbs.ts \
  '  const selection = time.handle.selection;
  if (!selection) return [];' \
  '  const selection = time.handle.selection;
  if (!selection || true) return [];' \
  "$VERBS"

echo
echo "== the guide, and what it is allowed to certify =="

probe "18 the arm phase goes back to passing for a reader who did nothing" \
  src/lib/acceptance/editor-steps.ts \
  '        expect: { kind: "armed" },' \
  '        expect: { kind: "no_write" },' \
  "$PHASE"

probe "19 «Yaptım» alone is enough, whatever the app did" \
  src/lib/acceptance/editor-steps.ts \
  '    case "armed":
      return !changed && revisionMoved === 0 && diff.armedAfter;' \
  '    case "armed":
      return true;' \
  "$PHASE"

probe "20 the arm is read from nowhere, so it is always false" \
  src/components/acceptance/useEditorWatch.ts \
  '  return node?.getAttribute("aria-pressed") === "true";' \
  '  return node !== undefined;' \
  "npx vitest run src/lib/acceptance/ src/lib/workspace/power-chord-extend.test.ts"

probe "21 the guide advances past a step it has not judged" \
  src/lib/acceptance/editor-steps.ts \
  '  return (phase.requires ?? []).filter((key) => checks[key] !== true);' \
  '  return [];' \
  "$PHASE"

echo
echo "== the listening route and its verdict =="

probe "22 a desktop run is allowed to call itself a physical pass" \
  src/lib/acceptance/listening-steps.ts \
  '  if (environment.touchPoints === 0) return "PARTIAL";' \
  '  if (false) return "PARTIAL";' \
  "$GUIDE"

probe "23 a founder saying the music was wrong stops being a failure" \
  src/lib/acceptance/listening-steps.ts \
  '  if (breaking.some((question) => answers[question.id] === BROKEN[question.id])) {
    return "FAIL";
  }' \
  '  if (false) {
    return "FAIL";
  }' \
  "$GUIDE"

probe "24 an unanswered listening question is rounded up to a pass" \
  src/lib/acceptance/listening-steps.ts \
  '  if (ALL_LISTENING_QUESTIONS.some((question) => !answers[question.id])) return "PARTIAL";' \
  '  if (false) return "PARTIAL";' \
  "$GUIDE"

probe "25 the block drops the loop questions" \
  src/lib/acceptance/listening-report.ts \
  '  { label: "Üç loop turu", keys: ["loopGap", "loopDoubleAttack", "loopTempo"] },' \
  '' \
  "$GUIDE"

probe "26 the block stops saying what kind of environment produced it" \
  src/lib/acceptance/listening-report.ts \
  '  return device.touchPoints === 0
    ? `masaüstü tarayıcı (dokunma 0) — fiziksel cihaz kanıtı değildir`
    : `dokunmatik cihaz (dokunma ${device.touchPoints})`;' \
  '  return "cihaz";' \
  "$GUIDE"

probe "27 the route stops refusing a build it was not sent to" \
  src/components/acceptance/SelectionPlaybackAcceptance.tsx \
  '  if (!mayStart(gate)) {' \
  '  if (false) {' \
  "$ISOLATION"

probe "28 the founder route grows a playback control of its own" \
  src/components/acceptance/SelectionPlaybackAcceptance.tsx \
  '              <Big
                testId="next"' \
  '              <button type="button">Seçimi dinle</button>
              <Big
                testId="next"' \
  "$ISOLATION"

probe "29 the route reaches into the readers own storage" \
  src/components/acceptance/SelectionPlaybackAcceptance.tsx \
  '  const [storageBefore] = useState(() => deviceStorageSnapshot());' \
  '  const [storageBefore] = useState(() => localStorage.getItem("aranje.project.1") ?? "");' \
  "$ISOLATION"

probe "30 a step starts speaking the apps own vocabulary" \
  src/lib/acceptance/listening-steps.ts \
  '    task: "«Daha fazla» → «Seçimi dinle».",' \
  '    task: "Drawer'"'"'da audition verb'"'"'ünü tick scope ile çalıştır.",' \
  "$GUIDE"

probe "31 the guide grows a ninth step" \
  src/lib/acceptance/listening-steps.ts \
  '  {
    id: "finish",
    title: "8 · Sonuç",' \
  '  {
    id: "finish",
    title: "9 · Fazladan",
    task: "Fazladan bir şey yap.",
    listenFor: "",
    questions: [],
  },
  {
    id: "finish",
    title: "8 · Sonuç",' \
  "$GUIDE"

probe "32 the route is left indexable" \
  src/app/eval/selection-playback/page.tsx \
  '  robots: { index: false, follow: false },' \
  '' \
  "$GUIDE"

echo
echo "-----------------------------------------------------------------"
echo "RED (a named test failed for the right reason): $pass"
echo "VACUOUS (mutant changed nothing observable):    $vacuous"
echo "INVALID (no test ran, or a timeout):            $invalid"
for entry in ${VACUOUS_LIST+"${VACUOUS_LIST[@]}"}; do echo "  vacuous: $entry"; done
for entry in ${INVALID_LIST+"${INVALID_LIST[@]}"}; do echo "  invalid: $entry"; done
[ "$vacuous" -eq 0 ] && [ "$invalid" -eq 0 ] || exit 1
