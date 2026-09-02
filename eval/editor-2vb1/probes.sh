#!/usr/bin/env bash
# The twenty-one mandatory negative probes (2V-B.1 §16).
#
# A green suite says nothing until you know it can go red. Each probe here
# breaks one thing on purpose — the way the corresponding defect would break
# it — and then requires the verification that is supposed to catch it to
# actually fail. A probe that stays green is a hole in the round's evidence,
# not a compliment.
#
# Three rules the runner enforces on itself:
#
# - **The mutation has to land.** Every edit asserts its own anchor text was
#   there and that the file changed. A probe whose edit silently did nothing
#   would be a vacuous green.
# - **The source comes back.** Every probe restores the file it touched, even
#   when the verification crashes, so a later probe measures the same code the
#   earlier ones did.
# - **A run of zero tests is a failure.** A verification that matched no test
#   file "passes" by saying nothing, which is exactly the failure a probe is
#   looking for.
#
# Usage:  eval/editor-2vb1/probes.sh          (unit probes only, fast)
#         PROBE_BROWSER=1 eval/editor-2vb1/probes.sh   (adds the two geometry
#         probes, each of which rebuilds and re-serves the app)
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT="eval/editor-2vb1/artifacts"
mkdir -p "$OUT"
RESULTS="$OUT/PROBES.json"
LOG=$(mktemp)
PASSED=0
FAILED=0
ROWS=()

# Replace exactly one occurrence, and prove it happened.
apply() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
source = open(path, encoding="utf-8").read()
if old not in source:
    print(f"ANCHOR MISSING in {path}")
    sys.exit(2)
changed = source.replace(old, new, 1)
if changed == source:
    print(f"MUTATION CHANGED NOTHING in {path}")
    sys.exit(2)
open(path, "w", encoding="utf-8").write(changed)
PY
}

# Run a vitest file and insist it both ran tests and went red.
expect_red() {
  local target="$1"
  if ! npx vitest run "$target" > "$LOG" 2>&1; then
    if grep -qE "Tests +[0-9]+ failed" "$LOG"; then
      return 0
    fi
    # A crash before any test ran is a timeout, not a finding (§16).
    echo "    (the suite failed without running tests — not a finding)"
    return 1
  fi
  return 1
}

probe() {
  local name="$1" file="$2" old="$3" new="$4" target="$5"
  echo "· $name"
  cp "$file" "$file.probe-backup"
  if ! apply "$file" "$old" "$new"; then
    echo "  INVALID — the mutation did not apply"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"invalid\",\"detail\":\"mutation did not apply\"}")
    FAILED=$((FAILED + 1))
    mv "$file.probe-backup" "$file"
    return
  fi
  # The mutation is real: the file differs from what is committed.
  local delta
  delta=$(diff "$file.probe-backup" "$file" | grep -c '^[<>]' || true)
  if expect_red "$target"; then
    echo "  red as it should be (mutation touched $delta lines)"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"red\",\"mutatedLines\":$delta,\"target\":\"$target\"}")
    PASSED=$((PASSED + 1))
  else
    echo "  STAYED GREEN — the verification does not catch this"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"green\",\"mutatedLines\":$delta,\"target\":\"$target\"}")
    FAILED=$((FAILED + 1))
  fi
  mv "$file.probe-backup" "$file"
}

ISO=src/lib/acceptance/isolation-truth.ts
LEDGER=src/lib/acceptance/transaction-ledger.ts
STEPS=src/lib/acceptance/batch-steps.ts
TASK=src/lib/acceptance/task-descriptor.ts
FIXTURE=src/lib/acceptance/editor-fixture.ts
VOICES=src/lib/audio/active-voices.ts
POOL=src/lib/audio/expressive-voice.ts
PLAYBACK=src/lib/audio/playback.ts
ROUTE=src/components/acceptance/EditorActionBatch.tsx
EVENTS=src/lib/song/workspace-events.ts
SELPLAY=src/lib/playback/selection-playback.ts
LISTEN=src/lib/workspace/use-selection-listening.ts
OWNER=src/lib/tab/pointer-ownership.ts
EVIDENCE=src/lib/acceptance/step-evidence.ts
VERBS=src/lib/workspace/selection-verbs.ts

echo "── isolation (§4) ──"
probe "1 · eval writes production storage" "$ISO" \
  'if (device.writes !== 0) {' 'if (false) {' \
  src/lib/acceptance/isolation-truth.test.ts

probe "2 · the fixture is not restored" "$ISO" \
  'if (!fixtureRestored) failures.push("eval_fixture_not_restored");' \
  '/* probe */' \
  src/lib/acceptance/isolation-truth.test.ts

probe "3 · the watcher reads the wrong store" "$ISO" \
  'if (device.holdsFixtureKey) failures.push("watcher_read_the_wrong_store");' \
  '/* probe */' \
  src/lib/acceptance/isolation-truth.test.ts

probe "4 · a restore invents a journalled write" "$ISO" \
  'if (fixture.restoreJournalEntries !== 0) {' 'if (false) {' \
  src/lib/acceptance/isolation-truth.test.ts

echo "── the action ledger (§5) ──"
probe "5 · paste creates two history steps" "$LEDGER" \
  'if (historyDelta !== 1) {' 'if (historyDelta < 1) {' \
  src/lib/acceptance/transaction-ledger.test.ts

probe "6 · move exposes a partial Song" "$LEDGER" \
  'for (const [name, pass] of Object.entries(input.semantic ?? {})) {' \
  'for (const [name, pass] of Object.entries({} as Record<string, boolean>)) {' \
  src/lib/acceptance/transaction-ledger.test.ts

probe "7 · undo comes back to different bytes" "$LEDGER" \
  'else if (input.undo.songBytes !== before.songBytes) failures.push("undo_hash_mismatch");' \
  '' \
  src/lib/acceptance/transaction-ledger.test.ts

probe "8 · redo does not return the written bytes" "$LEDGER" \
  'else if (input.redo.songBytes !== after.songBytes) failures.push("redo_hash_mismatch");' \
  '' \
  src/lib/acceptance/transaction-ledger.test.ts

probe "9 · a copy quietly commits" "$LEDGER" \
  'if (mutating !== 0) {
      failures.push(`copy_mutating_commands_expected_0_received_${mutating}`);
    }' '' \
  src/lib/acceptance/transaction-ledger.test.ts

probe "10 · a typed refusal writes anyway" "$LEDGER" \
  'if (writes !== 0) failures.push(`refusal_wrote_storage_${writes}`);' '' \
  src/lib/acceptance/transaction-ledger.test.ts

echo "── the fixture (§10) ──"
probe "11 · a repeat drops the let-ring data" "$FIXTURE" \
  'strum: "down" as const,
        letRing: true,' 'strum: "down" as const,' \
  src/lib/acceptance/editor-fixture.test.ts

probe "12 · the slide passage is not really a slide" "$FIXTURE" \
  '4: guitarHeld(2, 7, { articulation: "slide" }),' '4: guitarHeld(2, 7),' \
  src/lib/acceptance/editor-fixture.test.ts

# The first version of this probe moved one bass note from slot 0 to slot 9,
# which left the bass sounding in the same bar and was therefore not the
# defect it claimed to be. A probe that does not do what it says is a probe
# whose green means nothing, so it silences the track outright.
probe "13 · the second instrument is silent" "$FIXTURE" \
  'const SLIDE_BASS = fill({
  0: bassAt(0, 5),
  1: tie,
  2: tie,
  3: tie,
  8: bassAt(1, 5),
  9: tie,
  10: tie,
  11: tie,
});' 'const SLIDE_BASS = empty();' \
  src/lib/acceptance/editor-fixture.test.ts

echo "── voices and the transport (§6, §7, §8, §9) ──"
probe "14 · a slide resumes from its source pitch" "$VOICES" \
  'currentCents: cents,
    currentGain: gain,
    pitchAutomation: rebasePitch(pitchPoints, elapsed, cents),' \
  'currentCents: 0,
    currentGain: gain,
    pitchAutomation: rebasePitch(pitchPoints, elapsed, 0),' \
  src/lib/audio/active-voices.test.ts

probe "15 · a vibrato resumes as a plain sustain" "$VOICES" \
  'const ahead = points
    .filter((point) => point.timeSeconds > elapsed)
    .map((point) => ({
      timeSeconds: point.timeSeconds - elapsed,
      cents: point.cents,
      curve: point.curve,
    }));' \
  'const ahead: PitchPoint[] = [];' \
  src/lib/audio/active-voices.test.ts

probe "16 · a resumed note is struck again from the top" "$POOL" \
  'source.start(time, offset, continuation.remainingSeconds);' \
  'source.start(time, 0, continuation.remainingSeconds);' \
  src/lib/audio/expressive-voice.test.ts

probe "17 · a resumed hammer-on gains a pick attack" "$POOL" \
  '    this.resumedCount += 1;' \
  '    this.resumedCount += 1;
    this.auxiliaryCount += 1;' \
  src/lib/audio/expressive-voice.test.ts

# Both halves, because either one alone still catches this: the controller's
# own state and the transport's flag are deliberate belt and braces, and a
# probe that removed one would be measuring the other.
probe "18 · a queued wrap acts after the loop was turned off" "$PLAYBACK" \
  '      if (this.state.loop.kind === "none") return;
      if (!engine.context.transport.loop) return;' '' \
  src/lib/audio/playback-resume.test.ts

probe "19 · a disposed controller still starts playing" "$PLAYBACK" \
  '    if (this.disposed) return;
    if (this.state.status === "loading") return;' \
  '    if (this.state.status === "loading") return;' \
  src/lib/audio/playback-resume.test.ts

probe "20 · the paused tick is read after the transport moved" "$PLAYBACK" \
  '    const at = transport.ticks;
    // pause() keeps the tick position, unlike stop().
    transport.pause();' \
  '    transport.pause();
    const at = transport.ticks + 1;' \
  src/lib/audio/playback-resume.test.ts

probe "21 · a selection resume restores the whole song" "$PLAYBACK" \
  '    engine.expression.resumeAt(
      held,
      at,
      plan === null' \
  '    engine.expression.resumeAt(
      held,
      at,
      true' \
  src/lib/audio/playback-resume.test.ts

probe "22 · the same music in two key orders reads as two songs" "$EVENTS" \
  '  const bytes = JSON.stringify(canonical(song));' \
  '  const bytes = JSON.stringify(song);' \
  src/lib/song/workspace-events.test.ts

echo "── the task, the evidence and the answers (§12, §13, §14) ──"
probe "23 · an event about another Song is accepted" "$TASK" \
  'if (edit.songBefore !== descriptor.songFingerprint) {
    return { accepted: false, refusal: "wrong_song" };
  }' '' \
  src/lib/acceptance/task-descriptor.test.ts

probe "24 · an event from another session is accepted" "$TASK" \
  'if (stamp.sessionId !== descriptor.sessionId) {
    return { accepted: false, refusal: "wrong_session" };
  }' '' \
  src/lib/acceptance/task-descriptor.test.ts

probe "25 · an event from another build is accepted" "$TASK" \
  'if (stamp.buildSha !== descriptor.buildSha) {
    return { accepted: false, refusal: "wrong_build" };
  }' '' \
  src/lib/acceptance/task-descriptor.test.ts

probe "26 · an event for another step is accepted" "$TASK" \
  'if (edit.action !== descriptor.requiredAction) {
    return { accepted: false, refusal: "wrong_action" };
  }' '' \
  src/lib/acceptance/task-descriptor.test.ts

probe "27 · a task is asked about a passage the Song does not have" "$TASK" \
  '  if (!found) return { ok: false, reason: MISSING[passage] };' \
  '  if (!found) return { ok: true, place: support.firstWrittenBar! };' \
  src/lib/acceptance/task-descriptor.test.ts

probe "28 · a step passes with no production evidence" "$STEPS" \
  '  if (mutations.length === 0) shortfalls.push("no_production_event");' \
  '  if (false) shortfalls.push("no_production_event");' \
  src/lib/acceptance/batch-steps.test.ts

probe "29 · a step passes on the wrong action" "$STEPS" \
  '  else if (matching.length === 0) shortfalls.push("wrong_action");' '' \
  src/lib/acceptance/batch-steps.test.ts

probe "30 · answers count as given when they are empty" "$STEPS" \
  '    return given !== undefined && given !== null && given !== "";' \
  '    return true;' \
  src/lib/acceptance/batch-steps.test.ts

probe "31 · 11A and 11B may use the same filter" "$STEPS" \
  '  if (track && measure && sameFilter(track, measure)) return "FAIL";' '' \
  src/lib/acceptance/batch-steps.test.ts

probe "32 · a silent second instrument still passes" "$STEPS" \
  '  if (environment.secondTrackAudible === false) return "FAIL";' '' \
  src/lib/acceptance/batch-steps.test.ts

# ---------------------------------------------------------------- browser
#
# Two families can only be probed where they live: whether anything floats
# over the workspace, and whether an invisible layer owns a pointer. Both
# rebuild and re-serve, so they are opt-in.
browser_probe() {
  local name="$1" file="$2" old="$3" new="$4"
  echo "· $name"
  cp "$file" "$file.probe-backup"
  if ! apply "$file" "$old" "$new"; then
    echo "  INVALID — the mutation did not apply"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"invalid\"}")
    FAILED=$((FAILED + 1))
    mv "$file.probe-backup" "$file"
    return
  fi
  npm run build > "$LOG" 2>&1
  eval/editor-2vb1/serve.sh > /dev/null 2>&1
  if SHA="$(git rev-parse --short HEAD)" node eval/editor-2vb1/geometry.mjs > "$LOG" 2>&1; then
    echo "  STAYED GREEN — the geometry runner does not catch this"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"green\",\"target\":\"geometry.mjs\"}")
    FAILED=$((FAILED + 1))
  else
    if grep -q "checks ·" "$LOG"; then
      echo "  red as it should be"
      ROWS+=("{\"probe\":\"$name\",\"result\":\"red\",\"target\":\"geometry.mjs\"}")
      PASSED=$((PASSED + 1))
    else
      echo "  (the runner died before measuring — not a finding)"
      ROWS+=("{\"probe\":\"$name\",\"result\":\"invalid\",\"detail\":\"runner crashed\"}")
      FAILED=$((FAILED + 1))
    fi
  fi
  mv "$file.probe-backup" "$file"
}

if [ "${PROBE_BROWSER:-0}" = "1" ]; then
  echo "── geometry (§11, §15) ──"
echo "── the 2V-B.2 physical blockers ──"

probe "33 · a selection inside a held chord is called silent again" "$SELPLAY" \
  '  if (audible.length === 0 && sustaining.length === 0) {' \
  '  if (audible.length === 0) {' \
  src/lib/playback/selection-sustain.test.ts

probe "34 · a window keeps notes that had already finished" "$SELPLAY" \
  '  return event.time < window.startTicks && event.time + event.durationTicks > window.startTicks;' \
  '  return event.time < window.startTicks;' \
  src/lib/playback/selection-sustain.test.ts

probe "35 · a sustain from an unselected instrument leaks in" "$SELPLAY" \
  '  if (!window.trackIds.includes(event.trackId)) return false;' \
  '' \
  src/lib/playback/selection-sustain.test.ts

probe "36 · a refused press goes back to saying nothing" "$SELPLAY" \
  '    : { plan: null, refusal: refusalSentence(result.reason) };' \
  '    : { plan: null, refusal: null };' \
  src/lib/playback/selection-sustain.test.ts

probe "36b · the surface stops showing the refusal it was handed" "$VERBS" \
  '    notice: input.listening.refusal ?? time.handle.notice ?? null,' \
  '    notice: time.handle.notice ?? null,' \
  src/lib/workspace/selection-verbs.test.ts

probe "37 · panning takes a press that landed on a note" "$OWNER" \
  '  if (input.onEmptyBackground === true && input.hasSelection === true) {' \
  '  if (input.hasSelection === true) {' \
  src/lib/tab/background-pan.test.ts

probe "38 · panning eats the first long press on an empty staff" "$OWNER" \
  '  if (input.onEmptyBackground === true && input.hasSelection === true) {' \
  '  if (input.onEmptyBackground === true) {' \
  src/lib/tab/background-pan.test.ts

probe "39 · step 10 stops naming the press it is waiting for" "$EVIDENCE" \
  '    return "Bu adım «İleri al»ı da bekliyor: notaları geri aldıktan sonra ileri al'"'"'a dokun.";' \
  '    return null;' \
  src/lib/acceptance/step-evidence.test.ts

probe "40 · a redo onto different bytes counts as a redo" "$EVIDENCE" \
  '        last === written &&' \
  '' \
  src/lib/acceptance/step-evidence.test.ts

probe "41 · a stopped run can reach PASS" "$STEPS" \
  '  if (environment.endedEarly === true) return "BLOCKED";' \
  '' \
  src/lib/acceptance/batch-steps.test.ts

probe "42 · BLOCKED buries a measured storage break" "$STEPS" \
  '  if (environment.userStorageBefore !== environment.userStorageAfter) return "FAIL";' \
  '' \
  src/lib/acceptance/batch-steps.test.ts

probe "43 · the acceptance bass sinks back below a phone speaker" "$FIXTURE" \
  '  0: bassAt(2, 5),' \
  '  0: bassAt(0, 3),' \
  src/lib/acceptance/editor-fixture.test.ts

probe "44 · the bass moves in lockstep with the guitar again" "$FIXTURE" \
  '  3: bassAt(2, 7),
  6: bassAt(3, 5),
  10: bassAt(2, 7),
  13: bassAt(2, 5),' \
  '  4: bassAt(2, 7),' \
  src/lib/acceptance/editor-fixture.test.ts

echo "── browser (§16) ──"
  browser_probe "45 · the guide floats over the workspace again" "$ROUTE" \
    'className="border-line shrink-0 border-t px-3 py-2"' \
    'className="border-line fixed bottom-0 left-0 right-0 border-t px-3 py-2"'

  browser_probe "46 · an invisible layer owns the workspace's pointers" "$ROUTE" \
    '      {onSong ? (' \
    '      {onSong ? (
        <div
          data-probe-hidden-owner
          className="absolute inset-0 opacity-0"
          style={{ pointerEvents: "auto" }}
        />
      ) : null}
      {onSong ? ('
  npm run build > "$LOG" 2>&1
  eval/editor-2vb1/serve.sh > /dev/null 2>&1
fi

printf '{\n  "generatedAt": "%s",\n  "sha": "%s",\n  "passed": %d,\n  "failed": %d,\n  "probes": [\n    %s\n  ]\n}\n' \
  "$(date -u +%FT%TZ)" "$(git rev-parse HEAD)" "$PASSED" "$FAILED" \
  "$(IFS=$'\n'; echo "${ROWS[*]}" | paste -sd, - | sed 's/,/,\n    /g')" \
  > "$RESULTS"

echo
echo "$PASSED red · $FAILED not red · results in $RESULTS"
[ "$FAILED" -eq 0 ]
