#!/usr/bin/env bash
# Mutation probes for the founder handoff (2U-A handoff §9).
#
# Each probe breaks one promise the handoff makes and asserts that a named
# test goes red *for the right reason*. The runner is the 2U-A one, and it is
# stricter than "the command exited non-zero" for the three reasons §9 names:
#
# - **Zero tests run.** A mutation that breaks the parser exits non-zero having
#   asserted nothing. Counting that as RED credits a probe for a syntax error.
# - **A timeout alone.** A hung run says the machine was busy.
# - **An equivalent mutant.** A change that cannot alter behaviour stays green,
#   and reading that as "the test is vacuous" would be backwards — so green is
#   reported as VACUOUS, listed by name, and never summed away.
#
#   ./eval/editor-handoff/probes.sh
set -u

pass=0; vacuous=0; invalid=0
declare -a VACUOUS_LIST=()
declare -a INVALID_LIST=()
LOG="${PROBE_LOG:-/tmp/aranje-handoff-probe.log}"

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

BUILD="npx vitest run src/lib/acceptance/build-id.test.ts"
REPORT="npx vitest run src/lib/acceptance/editor-report.test.ts"
PHASE="npx vitest run src/lib/acceptance/editor-phase.test.ts"
INV="npx vitest run src/lib/acceptance/editor-invariants.test.ts"
FIXTURE="npx vitest run src/lib/acceptance/editor-fixture.test.ts"
ISO="npx vitest run src/lib/acceptance/editor-isolation.test.ts"
CAP="npx vitest run src/lib/song/selection-capability.test.ts"
MEAS="npx vitest run src/lib/song/measure-spine.test.ts"
VERBS="npx vitest run src/lib/workspace/selection-verbs.test.ts"
SERVER="npx vitest run src/test/server-only.test.ts"

echo "== §4 which build is on screen =="

probe "1 the build sha is written by hand instead of taken from the build" \
  src/lib/acceptance/build-id.ts \
  '  process.env.NEXT_PUBLIC_ARANJE_BUILD_SHA ?? "unknown";' \
  '  "5d2bb182eb1f10eda38462cfe89ef3ba67df700d";' \
  "$SERVER"

probe "2 a wrong version is allowed to start the test" \
  src/lib/acceptance/build-id.ts \
  'export function mayStart(gate: VersionGate): boolean {
  return gate.kind === "match" || gate.kind === "unpinned";
}' \
  'export function mayStart(_gate: VersionGate): boolean {
  return true;
}' \
  "$BUILD"

probe "3 a build that cannot name its commit counts as a match" \
  src/lib/acceptance/build-id.ts \
  '  if (actual === "unknown") {' \
  '  if (false) {' \
  "$BUILD"

probe "4 any prefix matches any other, so a different build passes" \
  src/lib/acceptance/build-id.ts \
  '  const agrees = have.startsWith(want) || want.startsWith(have);' \
  '  const agrees = true;' \
  "$BUILD"

echo
echo "== §3 the route touches nothing of the reader's =="

probe "5 the route reaches for the device's own store" \
  src/components/acceptance/EditorAcceptance.tsx \
  '  const [startedAt] = useState(() => new Date().toISOString());' \
  '  const [startedAt] = useState(() => String(localStorage.length));' \
  "$ISO"

probe "6 the route builds a project storage key of its own" \
  src/components/acceptance/useEditorWatch.ts \
  'import { readFixture } from "@/lib/acceptance/fixture-read";' \
  'import { readFixture } from "@/lib/acceptance/fixture-read";
const KEY = "aranje.project.1";
void KEY;' \
  "$ISO"

probe "7 the route calls something outside the origin" \
  src/components/acceptance/useEditorWatch.ts \
  '  const [userStorageBefore] = useState(() => deviceStorageSnapshot());' \
  '  const [userStorageBefore] = useState(() => { void fetch("/x"); return deviceStorageSnapshot(); });' \
  "$ISO"

probe "8 the route lets itself be indexed" \
  src/app/eval/editor-acceptance/page.tsx \
  '  robots: { index: false, follow: false },' \
  '  robots: { index: true, follow: true },' \
  "$ISO"

probe "9 a second session install quietly takes over" \
  src/lib/acceptance/session.ts \
  '  if (!project) {
    return {
      ok: false,' \
  '  if (false) {
    return {
      ok: false,' \
  "$ISO"

echo
echo "== §5 what the seven steps measure =="

probe "10 a gesture that wrote twice counts as one write" \
  src/lib/acceptance/editor-steps.ts \
  '      return changed && revisionMoved === 1;' \
  '      return changed;' \
  "$PHASE"

probe "11 a copy that wrote to the song still passes" \
  src/lib/acceptance/editor-steps.ts \
  '      return !changed && revisionMoved === 0;' \
  '      return true;' \
  "$PHASE"

probe "12 undo passes without coming back to the remembered bytes" \
  src/lib/acceptance/editor-steps.ts \
  '      if (remembered === undefined || diff.songAfter !== remembered) return false;' \
  '      if (false) return false;' \
  "$PHASE"

probe "13 a selection that shrank counts as one that grew" \
  src/lib/acceptance/editor-steps.ts \
  '      return expect.band === "wider"
        ? diff.bandAfter > diff.bandBefore
        : diff.bandAfter < diff.bandBefore;' \
  '      return true;' \
  "$PHASE"

probe "14 a string move may change the pitch it sounds" \
  src/lib/acceptance/editor-invariants.ts \
  '        moveKeptSoundingPitch:
          JSON.stringify(soundingPitches(before)) ===
          JSON.stringify(soundingPitches(after)),' \
  '        moveKeptSoundingPitch: true,' \
  "$INV"

probe "15 a duplicated measure may leave the second track behind" \
  src/lib/acceptance/editor-invariants.ts \
  '        measureOtherTrackKept:
          noteCount(after, bassTrackId) > noteCount(before, bassTrackId),' \
  '        measureOtherTrackKept: true,' \
  "$INV"

probe "16 a move may overwrite the notes it lands on" \
  src/lib/acceptance/editor-invariants.ts \
  '      return { moveNoOverwrite: noteCount(before) === noteCount(after) };' \
  '      return { moveNoOverwrite: true };' \
  "$INV"

probe "17 the fixture drops to one track, so “every track” cannot fail" \
  src/lib/acceptance/editor-fixture.ts \
  '      { ...EDITOR_BASS_TRACK, fretboard: { ...BASS_BOARD, tuning: [...BASS_STANDARD] } },' \
  '' \
  "$FIXTURE"

probe "18 the paste target is not empty, so a paste cannot land" \
  src/lib/acceptance/editor-fixture.ts \
  '          /* Deliberately empty on both tracks: this is the paste target. */
          bar(empty(), empty()),' \
  '          bar(MOTIF_GUITAR, MOTIF_BASS),' \
  "$FIXTURE"

echo
echo "== §5 the note/measure distinction =="

probe "19 measure verbs are offered on a note selection" \
  src/lib/song/selection-capability.ts \
  '    /* --------------------------------------------- the measure verbs */
    if (!isMeasures) return hidden;' \
  '    /* --------------------------------------------- the measure verbs */
    if (false) return hidden;' \
  "$CAP"

probe "20 a measure selection is guessed from the track count" \
  src/lib/song/selection-descriptor.ts \
  '    barScope: selection.scope,' \
  '    barScope: song.tracks.length > 1 ? "full" : "track",' \
  "$MEAS"

probe "21 “Devam” goes back to opening the composer" \
  src/lib/workspace/selection-verbs.ts \
  '    onContinue: time.toggleExtend,' \
  '    onContinue: () => {},' \
  "$VERBS"

echo
echo "== §6 what the page may say =="

probe "22 a clean automated run is written up as a founder pass" \
  src/lib/acceptance/editor-report.ts \
  '    "Founder verdict: Haktan doldurmadı",' \
  '    verdict === "PASS" ? "Founder verdict: PASS" : "Founder verdict: Haktan doldurmadı",' \
  "$REPORT"

probe "23 an unanswered question still counts as a pass" \
  src/lib/acceptance/editor-report.ts \
  '  if (ALL_QUESTIONS.some((question) => !answers[question.id])) return "PARTIAL";' \
  '  if (false) return "PARTIAL";' \
  "$REPORT"

probe "24 a step nobody reached counts as a pass" \
  src/lib/acceptance/editor-report.ts \
  '  if (verdicts.includes("pending")) return "PARTIAL";' \
  '  if (false) return "PARTIAL";' \
  "$REPORT"

probe "25 the reader's own store moving is not a failure" \
  src/lib/acceptance/editor-report.ts \
  '  if (observations.userStorageBefore !== observations.userStorageAfter) return "FAIL";' \
  '  if (false) return "FAIL";' \
  "$REPORT"

probe "26 a page that threw still reports a pass" \
  src/lib/acceptance/editor-report.ts \
  '  if (observations.consoleErrors.length > 0) return "FAIL";' \
  '  if (false) return "FAIL";' \
  "$REPORT"

probe "27 a failed row says FAIL without naming what failed" \
  src/lib/acceptance/editor-report.ts \
  '    const failed = keys.filter((key) => checks[key] === false);
    return `FAIL (${failed.join(", ")})`;' \
  '    return "FAIL";' \
  "$REPORT"

probe "28 the copied block comes out empty" \
  src/lib/acceptance/editor-report.ts \
  '  return [
    `${BRAND_NAME} Faz 2U-A Founder Editor Acceptance`,' \
  '  if (device) return "";
  return [
    `${BRAND_NAME} Faz 2U-A Founder Editor Acceptance`,' \
  "$REPORT"

probe "29 a check is quietly dropped from every row" \
  src/lib/acceptance/editor-report.ts \
  '{ label: "Zamanda taşı", keys: ["moveSelected", "moveTimeRight", "moveTimeLeft"] },' \
  '{ label: "Zamanda taşı", keys: ["moveTimeRight", "moveTimeLeft"] },' \
  "$REPORT"

probe "30 a step with a broken check still reports as passing" \
  src/lib/acceptance/editor-steps.ts \
  '  if (values.some((value) => value === false)) return "fail";' \
  '  if (false) return "fail";' \
  "$REPORT"

echo
echo "-----------------------------------------------------------------"
echo "RED (probe found the guard): $pass"
echo "VACUOUS (test proved nothing): $vacuous"
echo "INVALID (no evidence either way): $invalid"
for entry in ${VACUOUS_LIST+"${VACUOUS_LIST[@]}"}; do echo "  vacuous: $entry"; done
for entry in ${INVALID_LIST+"${INVALID_LIST[@]}"}; do echo "  invalid: $entry"; done

if [ "$vacuous" -ne 0 ] || [ "$invalid" -ne 0 ]; then exit 1; fi
if [ "$pass" -lt 16 ]; then echo "fewer than 16 meaningful probes"; exit 1; fi
echo "PASS — $pass meaningful probes, all named-red"
