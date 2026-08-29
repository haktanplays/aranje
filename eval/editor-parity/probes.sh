#!/usr/bin/env bash
# Mutation probes for 2U-A (§14).
#
# Each probe breaks one guarantee in the product code and asserts that a named
# test goes red *for the right reason*. A test that stays green is testing
# nothing, and this is the only way to find that out.
#
# ## Why this runner is stricter than "the command exited non-zero"
#
# Three things exit non-zero without proving anything, and §14 rules out all
# three by name:
#
# - **Zero tests run.** A mutation that breaks the parser makes vitest exit
#   non-zero having asserted nothing. Counting that as RED credits a probe for
#   a syntax error.
# - **A timeout alone.** A hung run says the machine was busy, not that the
#   guarantee held.
# - **An equivalent mutant.** A change that cannot alter behaviour will stay
#   green, and reading that as "the test is vacuous" would be backwards — so
#   green is reported as VACUOUS and every one is listed, never summed away.
#
# So a probe counts only when vitest reports a positive test count *and* at
# least one failed assertion. Anything else is INVALID and fails the run.
#
#   ./eval/editor-parity/probes.sh
set -u

pass=0; vacuous=0; invalid=0
declare -a VACUOUS_LIST=()
declare -a INVALID_LIST=()

LOG="${PROBE_LOG:-/tmp/aranje-2ua-probe.log}"

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

  # 120s is generous for a targeted suite; a probe that needs longer is a
  # probe whose evidence would be "the machine was slow".
  timeout 120 bash -c "$cmd" > "$LOG" 2>&1
  local code=$?
  mv "$file.probebak" "$file"

  if [ $code -eq 124 ]; then
    echo "INVALID $name (timed out — a hang is not evidence)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: timeout")
    return
  fi

  # "Tests  N failed | M passed (T)" — T is what actually ran.
  local total failed
  total=$(grep -oE 'Tests +[0-9|a-z ]*\(([0-9]+)\)' "$LOG" | grep -oE '\(([0-9]+)\)$' | tr -d '()' | tail -1)
  failed=$(grep -oE 'Tests +([0-9]+) failed' "$LOG" | grep -oE '[0-9]+' | tail -1)
  total=${total:-0}
  failed=${failed:-0}

  if [ "$total" -eq 0 ]; then
    echo "INVALID $name (no test ran — the mutation broke the build, not the guarantee)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: zero tests run")
    return
  fi

  if [ "$failed" -gt 0 ]; then
    echo "RED     $name  ($failed of $total)"
    pass=$((pass+1))
  else
    echo "GREEN   $name  <-- VACUOUS ($total ran, none failed)"
    vacuous=$((vacuous+1)); VACUOUS_LIST+=("$name")
  fi
}

DESC="npx vitest run src/lib/song/selection-descriptor.test.ts"
CAP="npx vitest run src/lib/song/selection-capability.test.ts"
SPINE="npx vitest run src/lib/song/editor-spine.test.ts"
MEAS="npx vitest run src/lib/song/measure-spine.test.ts"
MOVE="npx vitest run src/lib/song/movement-menu.test.ts"
VERBS="npx vitest run src/lib/workspace/selection-verbs.test.ts"
BAR="npx vitest run src/lib/song/bar-transform.test.ts"
PTR="npx vitest run src/lib/tab/pointer-ownership.test.ts"
HIST="npx vitest run src/lib/song/history-boundary.test.ts"

echo "== §2 the descriptor says what is held =="

probe "1 a chord is reported as a note" \
  src/lib/song/selection-descriptor.ts \
  'struck.length === 1 ? (eventIds.length === 1 ? "note" : "chord") : "range"' \
  '"note"' "$DESC"

probe "2 a range is reported as a chord" \
  src/lib/song/selection-descriptor.ts \
  'struck.length === 1 ? (eventIds.length === 1 ? "note" : "chord") : "range"' \
  'eventIds.length === 1 ? "note" : "chord"' "$DESC"

probe "3 whole-bar edges are claimed for any span" \
  src/lib/song/selection-descriptor.ts \
  '  if (endTicks <= startTicks) return false;
  const spans = barSpans(section);
  return (
    spans.some((span) => span.start === startTicks) &&
    spans.some((span) => span.end === endTicks)
  );' \
  '  return endTicks > startTicks;' "$DESC"

probe "4 event identity drops the string, so a chord is one note" \
  src/lib/song/selection-descriptor.ts \
  '    input.trackId,
    input.stringIndex,
  ].join(":");' \
  '    input.trackId,
  ].join(":");' "$DESC"

probe "5 event identity drops the slot, so two moments share an address" \
  src/lib/song/selection-descriptor.ts \
  '    input.barIndex,
    input.slotIndex,' \
  '    input.barIndex,' "$DESC"

probe "6 a bar selection forgets which scope it is" \
  src/lib/song/selection-descriptor.ts \
  '    barScope: selection.scope,' \
  '    barScope: "full",' "$MEAS"

probe "7 a full bar selection covers one track instead of all" \
  src/lib/song/selection-descriptor.ts \
  '    selection.scope === "track"
      ? [selection.trackId]
      : song.tracks.map((track) => track.id);' \
  '    song.tracks.slice(0, 1).map((track) => track.id);' "$DESC"

probe "8 the bar range is off by one at the end" \
  src/lib/song/selection-descriptor.ts \
  '  return first === -1 ? null : { startBarIndex: first, endBarIndex: last };' \
  '  return first === -1 ? null : { startBarIndex: first, endBarIndex: first };' "$DESC"

echo
echo "== §3 what a selection offers =="

probe "9 every verb is offered, whatever is selected" \
  src/lib/song/selection-capability.ts \
  '  return ALL_VERBS.map((verb) => ({ verb, state: stateOf(verb) }));' \
  '  return ALL_VERBS.map((verb) => ({ verb, state: available }));' "$CAP"

probe "10 “Bağla” is offered on a single note" \
  src/lib/song/selection-capability.ts \
  '        return descriptor.onsetCount >= 2
          ? available
          : disabled("Bağlamak için en az iki nota gerekiyor.");' \
  '        return available;' "$CAP"

probe "11 paste is offered with an empty clipboard" \
  src/lib/song/selection-capability.ts \
  '        if (!context.hasClipboard) {
          return disabled("Panoda bir şey yok.");
        }' \
  '        if (false) {
          return disabled("Panoda bir şey yok.");
        }' "$CAP"

probe "12 copied bars are silently pasteable into a run of notes" \
  src/lib/song/selection-capability.ts \
  '        if (context.clipboardScope !== "range") {' \
  '        if (false) {' "$CAP"

probe "13 the measure verbs are offered on a run of notes" \
  src/lib/song/selection-capability.ts \
  '    /* --------------------------------------------- the measure verbs */
    if (!isMeasures) return hidden;' \
  '    /* --------------------------------------------- the measure verbs */
    if (false) return hidden;' "$CAP"

probe "14 the chord verbs are offered on any range" \
  src/lib/song/selection-capability.ts \
  '      if (isChord) return available;' \
  '      return available;' "$CAP"

probe "15 a one-instrument bar is offered “Ölçü ekle”" \
  src/lib/song/selection-capability.ts \
  '    if (descriptor.barScope === "track" && FULL_SCOPE_VERBS.includes(verb)) {' \
  '    if (false) {' "$MEAS"

probe "16 the last bar of a section can be deleted after all" \
  src/lib/song/selection-capability.ts \
  '      return context.sectionBarCount > barCount(descriptor)
        ? available
        : disabled("Şarkıda en az bir ölçü kalmalı.");' \
  '      return available;' "$CAP"

probe "17 the first bar is offered “Sola taşı”" \
  src/lib/song/selection-capability.ts \
  '      return firstBar > 0 ? available : disabled("Bu ilk ölçü.");' \
  '      return available;' "$CAP"

probe "18 the last bar is offered “Sağa taşı”" \
  src/lib/song/selection-capability.ts \
  '      return lastBar < context.sectionBarCount - 1
        ? available
        : disabled("Bu son ölçü.");' \
  '      return available;' "$CAP"

probe "19 a surface is told to draw the hidden verbs too" \
  src/lib/song/selection-capability.ts \
  '  return offers.filter((offer) => offer.state.kind !== "hidden");' \
  '  return offers;' "$CAP"

probe "20 a disabled verb reports as runnable" \
  src/lib/song/selection-capability.ts \
  '    (offer) => offer.verb === verb && offer.state.kind === "available",' \
  '    (offer) => offer.verb === verb,' "$CAP"

probe "21 the drawer names a verb the model never answers for" \
  src/lib/workspace/selection-verbs.ts \
  '  { key: "onDelete", verb: "delete" },' \
  '  { key: "onDelete", verb: "delete_bar" },' "$VERBS"

probe "22 the toolbar stops asking what this selection can do" \
  src/lib/workspace/selection-verbs.ts \
  '  const offers = descriptor
    ? offeredVerbs(' \
  '  const offers = false
    ? offeredVerbs(' "$VERBS"

probe "23 “Devam” goes back to staging instead of reaching" \
  src/lib/workspace/selection-verbs.ts \
  '    onContinue: time.toggleExtend,' \
  '    onContinue: () => {},' "$VERBS"

echo
echo "== §4-§8 the clipboard and the movements =="

probe "24 a copied note still points at the song it came from" \
  src/lib/song/transform.ts \
  'const detachedNote = (note: NoteEvent): NoteEvent => structuredClone(note);' \
  'const detachedNote = (note: NoteEvent): NoteEvent => ({ ...note });' "$SPINE"

# The obvious probe here — dropping `detachedNote` from the *write* path — is
# an equivalent mutant and is deliberately not used. `settle()` deep-clones the
# song on the way out of `applyTransform`, so a slot that shares its notes with
# the clipboard inside the function shares nothing by the time a caller sees
# it: the mutation cannot change observable behaviour, and no test can go red
# for it. The detach stays as defence in depth (nothing should rely on
# `settle` cloning forever), and this probe measures a boundary that is real.
probe "25 the two clipboards are silently interchangeable" \
  src/lib/workspace/selection-verbs.ts \
  'clipboardScope: time.handle.hasClipboard ? "range" : null,' \
  'clipboardScope: time.handle.hasClipboard ? "measures" : null,' "$VERBS"

probe "26 a movement quantises the motif's inner rhythm to the step" \
  src/lib/song/transform.ts \
  '      offsetTicks: entry.startTicks - selection.startTicks,' \
  '      offsetTicks: 0,' "$SPINE"

echo
echo "== §9-§11 holding bars =="

probe "27 an armed pen writes into a bar header" \
  src/lib/tab/pointer-ownership.ts \
  '  if (input.onMeasureHeader === true) return "measure";
  if (input.penArmed) return "pen";' \
  '  if (input.penArmed) return "pen";
  if (input.onMeasureHeader === true) return "measure";' "$PTR"

probe "28 the duration handle loses the drag to a header" \
  src/lib/tab/pointer-ownership.ts \
  '  if (input.onDurationHandle === true) return "duration";' \
  '  if (false) return "duration";' "$MEAS"

probe "29 a press extends instead of taking hold" \
  src/lib/song/measure-gesture.ts \
  '  if (gesture.kind === "press") {' \
  '  if (false) {' "$MEAS"

probe "30 one edge is allowed to cross the other" \
  src/lib/song/measure-gesture.ts \
  '          startBarIndex: Math.min(gesture.barIndex, current.endBarIndex),' \
  '          startBarIndex: gesture.barIndex,' "$MEAS"

probe "31 a reach into another instrument is allowed" \
  src/lib/song/measure-gesture.ts \
  '    current.scope === "track" &&
    gesture.trackId !== undefined &&
    gesture.trackId !== current.trackId' \
  '    false' "$MEAS"

probe "32 a reach past the end of the section is allowed" \
  src/lib/song/measure-gesture.ts \
  '    gesture.barIndex >= bounds.barCount' \
  '    false' "$MEAS"

probe "33 a reach from nothing invents a selection" \
  src/lib/song/measure-gesture.ts \
  '  if (!current) {
    return fail("nothing_held", "Genişletmek için önce bir ölçü seçilmeli.");
  }' \
  '  if (!current) {
    return {
      ok: true,
      selection: {
        scope: "full",
        sectionId: gesture.sectionId,
        startBarIndex: gesture.barIndex,
        endBarIndex: gesture.barIndex,
      },
      barCount: 1,
      unchanged: false,
    };
  }' "$MEAS"

probe "34 a run of bars leaves a hole in the middle" \
  src/lib/song/measure-gesture.ts \
  '    index <= selection.endBarIndex;' \
  '    index < selection.endBarIndex;' "$MEAS"

echo
echo "== §10-§12 what a measure operation writes =="

probe "35 inserting a bar is offered on one instrument's selection" \
  src/lib/song/bar-transform.ts \
  '    case "insert_blank_bar_before":
    case "insert_blank_bar_after": {
      if (selection.scope !== "full") {' \
  '    case "insert_blank_bar_before":
    case "insert_blank_bar_after": {
      if (false) {' "$MEAS"

probe "36 a section is allowed to run out of bars" \
  src/lib/song/bar-transform.ts \
  '      if (section.bars.length - length < 1) {' \
  '      if (false) {' "$MEAS"

probe "37 a move past the end of the section is allowed" \
  src/lib/song/bar-transform.ts \
  '      const neighbourIndex = left ? start - 1 : end + 1;
      if (neighbourIndex < 0 || neighbourIndex >= section.bars.length) {' \
  '      const neighbourIndex = left ? start - 1 : end + 1;
      if (false) {' "$MEAS"

probe "38 a command mutates the song it was given" \
  src/lib/song/bar-transform.ts \
  '      const bars = section.bars.filter(
        (_, index) => index < start || index > end,
      );' \
  '      const bars = section.bars;
      bars.splice(start, end - start + 1);' "$MEAS"

echo
echo "== the promises about the promises =="

probe "39 “Taşı” quietly offers seven movements" \
  src/lib/song/movement-menu.ts \
  '  { id: "shape-fret", mode: "shape", label: "Şekli perde yönünde", testPrefix: "shape-fret" },' \
  '' "$MOVE"

probe "40 a product module may record its own history step" \
  src/lib/song/measure-gesture.ts \
  'export function barsInSelection' \
  'const sneak = () => recordEdit();
export function barsInSelection' "$HIST"

echo
echo "-----------------------------------------------------------------"
echo "RED (probe found the guard): $pass"
echo "VACUOUS (test proved nothing): $vacuous"
echo "INVALID (no evidence either way): $invalid"
for entry in ${VACUOUS_LIST+"${VACUOUS_LIST[@]}"}; do echo "  vacuous: $entry"; done
for entry in ${INVALID_LIST+"${INVALID_LIST[@]}"}; do echo "  invalid: $entry"; done

if [ "$vacuous" -ne 0 ] || [ "$invalid" -ne 0 ]; then exit 1; fi
if [ "$pass" -lt 32 ]; then echo "fewer than 32 meaningful probes"; exit 1; fi
echo "PASS — $pass meaningful probes, all named-red"
