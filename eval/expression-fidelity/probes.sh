#!/usr/bin/env bash
# Fourteen corruptions of this batch's fixes, each required to go red
# (2V-C.2 §18).
#
# Every fix here answers a measured defect, and a test that catches a defect
# today says nothing about whether it will catch it tomorrow. So each probe
# puts one defect *back* — the exact shape of it, one edit at a time — and
# demands that the verification fail. Several of them are the shipped code as
# it stood before this batch, which is the strongest form the question takes:
# would the suite have caught what the founder heard?
#
# **Run this alone.** The probes edit source in place and restore it
# afterwards; a test run started beside them measures a half-mutated tree and
# reports a failure that is an artefact of the runner, not of the code. That
# happened once in 2V-B.2 and cost a full re-run.
#
# Usage:  eval/expression-fidelity/probes.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT="eval/expression-fidelity/artifacts"
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


SHAPE=src/lib/audio/gesture-shape.ts
PRESETS=src/lib/audio/expression.ts
GESTURE=src/lib/audio/pitch-gesture.ts
SHIFT=src/lib/audio/shift-slide.ts
PLAN=src/lib/audio/expression-plan.ts
WRITE=src/lib/song/gesture-write.ts
INSPECT=src/lib/song/gesture-inspect.ts
DISTANCE=src/lib/music/slide-distance.ts
RESULT=src/lib/listening/listening-result.ts
SCOPE=src/lib/listening/listening-scope.ts
AUTHORITY=src/lib/listening/founder-authority.ts

FIDELITY=src/lib/audio/gesture-fidelity.test.ts
LEGACY=src/lib/audio/legacy-preserved.test.ts
PLAYBACK=src/lib/audio/gesture-playback.test.ts
EDIT=src/lib/song/gesture-edit.test.ts
FOUNDER=src/lib/listening/founder-authority.test.ts
PACK=src/lib/listening/listening-pack.test.ts

echo "── the bend release goes back to what the founder heard (§6) ──"
probe "1 · the return lands on the note's last sample again" "$GESTURE" \
  '    const returnedAt = round(holdEnd + releaseSeconds);
    if (durationSeconds > returnedAt) {' \
  '    const returnedAt = round(holdEnd + releaseSeconds);
    if (false && durationSeconds > returnedAt) {' \
  "$FIDELITY"

probe "2 · the release is quicker than the rise again" "$PRESETS" \
  '      ratioToRise: 1.15,' \
  '      ratioToRise: 0.65,' \
  "$FIDELITY"

# Zeroing `restFraction` alone is not the defect: `restMinSeconds` is a floor
# and the rest survives it, which is the clamp doing its job. The ceiling is
# what removes the stretch entirely.
probe "3 · there is no rest at the written pitch" "$PRESETS" \
  '      restMaxSeconds: 0.26,' \
  '      restMaxSeconds: 0,' \
  "$FIDELITY"

probe "4 · the descent may start before the target is reached" "$SHAPE" \
  '  const releaseStartsAt = reachedAt + hold;' \
  '  const releaseStartsAt = Math.max(0, reachedAt - hold);' \
  "$FIDELITY"

probe "5 · a short note writes automation past its own end" "$SHAPE" \
  '  const needed = settle + rise + release + rest;
  if (needed > durationSeconds && needed > 0) {' \
  '  const needed = settle + rise + release + rest;
  if (false && needed > durationSeconds && needed > 0) {' \
  "$FIDELITY"

echo "── the pre-bend leaks the flat pitch again (§8) ──"
probe "6 · the first audible frame is no longer the target" "$GESTURE" \
  '    points.push({ timeSeconds: 0, cents: target, curve: "step" });' \
  '    points.push({ timeSeconds: 0, cents: 0, curve: "step" });' \
  "$FIDELITY"

echo "── the shift slide goes back to striking the source pitch (§9) ──"
probe "7 · nothing travels during the source note" "$PLAN" \
  '    applyShiftSlides(planned, shiftSlides, new Set(built.membership.keys()));' \
  '    applyShiftSlides(planned, [], new Set(built.membership.keys()));' \
  "$PLAYBACK"

probe "8 · the hand arrives after the target is struck" "$SHIFT" \
  '      leaves,
      round(handover),' \
  '      leaves,
      round(handover + travel),' \
  "$PLAYBACK"

probe "9 · the source is let go before it gets there" "$SHIFT" \
  '      durationSeconds: round(handover),' \
  '      durationSeconds: source.durationSeconds,' \
  "$PLAYBACK"

# The chain guard in `applyShiftSlides` is deliberately not probed. No fixture
# reaches it — a legato slide never produces a shift-slide link, so removing
# the guard changes nothing today. It is defence in depth against a future
# note that is both, and calling an unreachable branch "covered" would be the
# kind of claim this file exists to prevent.

echo "── the open slides lose their shape (§10, §11) ──"
probe "11 · the slide-out is cut at full voice again" "$PLAN" \
  '      ...(gesture.kind === "slide_out"' \
  '      ...(false && gesture.kind === "slide_out"' \
  "$FIDELITY"

probe "12 · the slide-in is given the exit's fade" "$PLAN" \
  '      ...(gesture.kind === "slide_out"' \
  '      ...(gesture.kind === "slide_out" || gesture.kind === "slide_in"' \
  "$FIDELITY"

echo "── the legacy path stops being separate (§7) ──"
probe "13 · an old bend_full is planned through the new shape" "$GESTURE" \
  '  const coming = returnsToWritten(gesture.kind)' \
  '  const coming = (true as boolean)' \
  "$LEGACY"

echo "── the distance stops being a bounded choice (§12) ──"
probe "14 · an approach off the neck is written anyway" "$WRITE" \
  '    if (!approachIsPlayable(track.fretboard, note.position, gesture, semitones)) {
      return fail("slide_off_the_neck");
    }' \
  '    if (false) {
      return fail("slide_off_the_neck");
    }' \
  "$EDIT"

probe "15 · the three words collapse to one interval" "$DISTANCE" \
  '  { id: "short", label: "Kısa", semitones: 1, spoken: "Bir perde." },' \
  '  { id: "short", label: "Kısa", semitones: 2, spoken: "Bir perde." },' \
  "$EDIT"

echo "── removing one axis takes another with it (§13) ──"
probe "16 · removing the bend also drops the connection" "$WRITE" \
  '  if (command.connection !== undefined) {' \
  '  if (command.pitchGesture === null || command.connection !== undefined) {' \
  "$EDIT"

probe "17 · a legacy articulation is reported as a removable gesture" "$INSPECT" \
  '    hasPitchGesture: note.pitchGesture !== undefined,' \
  '    hasPitchGesture: reading.pitch !== null,' \
  "$EDIT"

echo "── the listening scope forgets what the founder said (§4, §5) ──"
probe "18 · the round counts every card ever built again" "$RESULT" \
  '  const asked = activeClips(input.clips);' \
  '  const asked = input.clips;' \
  "$PACK"

probe "19 · an archived result becomes answerable" "$SCOPE" \
  '  return clips.filter((clip) => !isArchived(clip.id));' \
  '  return clips;' \
  "$FOUNDER"

probe "20 · L14 is promoted to a pass" "$AUTHORITY" \
  '    verdict: "needs_polish",
    note: "Bu biraz daha iyileştirilmeli.",' \
  '    verdict: "pass",
    note: "Bu biraz daha iyileştirilmeli.",' \
  "$FOUNDER"

probe "21 · the card number is printed instead of its name again" "$RESULT" \
  '    lines.push(`${clip.id} ${clip.label}: ${answer}${note === "" ? "" : ` — ${note}`}`);' \
  '    lines.push(`${clip.id} ${clip.id}: ${answer}${note === "" ? "" : ` — ${note}`}`);' \
  "$PACK"

probe "22 · a comment without a verdict is read as one" "$RESULT" \
  '        : UNMEASURED_WITH_NOTE;' \
  '        : "Olmuş";' \
  "$PACK"

printf '{\n  "generatedAt": "%s",\n  "sha": "%s",\n  "passed": %d,\n  "failed": %d,\n  "probes": [\n    %s\n  ]\n}\n' \
  "$(date -u +%FT%TZ)" "$(git rev-parse HEAD)" "$PASSED" "$FAILED" \
  "$(IFS=$'\n'; echo "${ROWS[*]}" | paste -sd, - | sed 's/,/,\n    /g')" \
  > "$RESULTS"

echo
echo "$PASSED red · $FAILED not red · results in $RESULTS"
[ "$FAILED" -eq 0 ]
