#!/usr/bin/env bash
# Corruptions of the slide family's fixes, each required to go red
# (2V-C.2 §18, 2V-C.3 §17).
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


SHAPE_GAIN=src/lib/audio/gesture-shape.ts
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
ENVELOPE=src/lib/audio/handoff-envelope.ts
ONSET=src/lib/audio/sample-onset.ts
ENVFID=src/lib/audio/handoff-envelope.test.ts
ONSETFID=src/lib/audio/sample-onset.test.ts
SEAMPCM=eval/expression-fidelity/seam-pcm.ts
SEAMFID=eval/expression-fidelity/seam-pcm.test.ts
SEAMFX=eval/expression-fidelity/seam-fixtures.ts
SEAMFXFID=eval/expression-fidelity/seam-fixtures.test.ts

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

probe "4 · the descent may start before the target is reached" "$SHAPE_GAIN" \
  '  const releaseStartsAt = reachedAt + hold;' \
  '  const releaseStartsAt = Math.max(0, reachedAt - hold);' \
  "$FIDELITY"

probe "5 · a short note writes automation past its own end" "$SHAPE_GAIN" \
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
  '      planned,
      shiftSlides,' \
  '      planned,
      [],' \
  "$PLAYBACK"

probe "8 · the hand arrives after the target is struck" "$SHIFT" \
  '      leaves,
      round(handover),' \
  '      leaves,
      round(handover + travel),' \
  "$PLAYBACK"

probe "9 · the source is let go before it gets there" "$SHIFT" \
  '      durationSeconds: envelope.endSeconds,' \
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


echo "── the invented shift mark comes back (2V-C.3 §5) ──"
LANG_SRC=src/lib/music/gesture-language.ts
GEOM=src/lib/tab/technique-geometry.ts
NOTATION=src/lib/tab/slide-notation.test.ts
SHAPE=src/lib/song/shape-slide.ts
SHAPEWRITE=src/lib/song/shape-slide-write.ts
SHAPETEST=src/lib/song/shape-slide.test.ts
SHAPEINV=src/lib/song/shape-invariants.test.ts
SLIDEFID=src/lib/audio/slide-fidelity.test.ts
HANDOFF=src/lib/audio/shift-slide.ts

probe "23 · a letter of our own is written beside the slash" "$LANG_SRC" \
  '      return { mark: lean, spoken: "önceki notadan kaydır ve yeniden vur" };' \
  '      return { mark: `s${lean}`, spoken: "önceki notadan kaydır ve yeniden vur" };' \
  "$NOTATION"

probe "24 · the two slides stop being told apart at all" "$LANG_SRC" \
  '      return { mark: lean, spoken: "önceki notadan bağlı kaydır", slur: true };
    default:' \
  '      return { mark: lean, spoken: "önceki notadan bağlı kaydır" };
    default:' \
  "$NOTATION"

probe "25 · the explicit connections stop drawing a connector" "$GEOM" \
  '  if (joined.mark !== "/" && joined.mark !== "\\") return null;' \
  '  if (span.articulation !== "slide") return null;' \
  "$NOTATION"

probe "26 · a shift slide is drawn with a slur" "$GEOM" \
  '  return { slur: joined.slur === true };' \
  '  return { slur: true };' \
  "$NOTATION"

echo "── the shape stops being a shape (2V-C.3 §9, §10) ──"
probe "27 · one string sliding counts as a shape" "$SHAPE" \
  '  if (moving.length < MIN_SHAPE_STRINGS) return refuse("not_a_shape");' \
  '  if (moving.length < 1) return refuse("not_a_shape");' \
  "$SHAPETEST"

probe "28 · the strings may travel different distances" "$SHAPE" \
  '    else if (step !== interval) return refuse("shape_not_preserved");' \
  '    else if (false) return refuse("shape_not_preserved");' \
  "$SHAPETEST"

probe "29 · an open string is carried along" "$SHAPE" \
  '    if (fromFret === 0 || toFret === 0) return refuse("open_string_moving");' \
  '    if (false) return refuse("open_string_moving");' \
  "$SHAPETEST"

probe "30 · the two sides may be different strings" "$SHAPE" \
  '  if (sourceVoices.size !== moving.length) return refuse("string_set_differs");' \
  '  if (false) return refuse("string_set_differs");' \
  "$SHAPETEST"

probe "31 · half the shape may be legato and half struck" "$SHAPE" \
  '  if (kinds.size !== 1) return refuse("mixed_connection_kinds");' \
  '  if (false) return refuse("mixed_connection_kinds");' \
  "$SHAPETEST"

probe "32 · the write commits before it validates the shape" "$SHAPEWRITE" \
  '    const derived = shapeSlideAt(candidate, command);
    if (!derived.ok) return refuse(derived.reason);' \
  '    const derived = shapeSlideAt(candidate, command);
    if (false && !derived.ok) return refuse(derived.reason);' \
  "$SHAPETEST"

# A capo and an alternate tuning cannot separate these two readings: on one
# string a fret delta *is* the semitone delta, and both notes shift equally.
# What separates them is a Song whose written pitch and written fret disagree,
# which is what the fixture behind this probe builds.
probe "33 · the direction is read from the fret instead of the ear" "$SHAPE" \
  '    const step = toMidi - fromMidi;' \
  '    const step = toFret - fromFret;' \
  "$SHAPEINV"

echo "── the handoff goes back to a cut (2V-C.3 §3, §4) ──"
probe "34 · the source stops at full level again" "$SHIFT" \
  '      gainEnvelope: [...envelope.points],' \
  '      gainEnvelope: [],' \
  "$SLIDEFID"

# The A3 the pair fixture lands on has the pack's slowest attack, so its
# handover reads the *slow* end of the interpolation; mutating the fast end
# here would leave the fixture untouched and the probe would look covered.
probe "35 · the source is faded to nothing instead of handed over" "$PRESETS" \
  '    handoverSlowFraction: 0.6,' \
  '    handoverSlowFraction: 0.02,' \
  "$SLIDEFID"

probe "36 · the fade starts before the hand moves" "$ENVELOPE" \
  '  const fadeStart = round(handover - travel);' \
  '  const fadeStart = 0;' \
  "$SLIDEFID"

echo "── the three distances stop being one movement (2V-C.3 §7) ──"
probe "37 · the open slide borrows the note-to-note floor again" "$GESTURE" \
  '  const wanted = Math.max(
    preset.openMinSeconds,
    (semitones * preset.openMsPerSemitone) / 1000,
  );' \
  '  const wanted = Math.max(preset.openMinSeconds, preset.minGlideSeconds);' \
  "$SLIDEFID"

probe "38 · a longer distance is taken at a faster speed" "$PRESETS" \
  '    openMsPerSemitone: 70,' \
  '    openMsPerSemitone: 20,' \
  "$SLIDEFID"

echo "── the founder's record is rewritten (2V-C.3 §1) ──"
probe "39 · L19 is promoted to a pass" "$AUTHORITY" \
  '    id: "L19",
    title: "Bağlı / vurarak kaydırma",
    verdict: "conditional_pass",' \
  '    id: "L19",
    title: "Bağlı / vurarak kaydırma",
    verdict: "pass",' \
  "$FOUNDER"

probe "40 · L22 is given a sentence nobody said" "$AUTHORITY" \
  '  { id: "L22", title: "Kayarak giriş", verdict: "pass" },' \
  '  { id: "L22", title: "Kayarak giriş", verdict: "pass", note: "Temiz." },' \
  "$FOUNDER"

probe "41 · the round re-asks the cards that are already answered" "$SCOPE" \
  'export const ACTIVE_CLIP_IDS = ["L25", "L26"] as const;' \
  'export const ACTIVE_CLIP_IDS = ["L21", "L22", "L23", "L24"] as const;' \
  "$FOUNDER"

echo "── the source stops at the onset again, which is the defect (2V-C.4 §7) ──"
probe "42 · the tail past the target's onset is removed" "$ENVELOPE" \
  '  if (end > handover) points.push({ timeSeconds: end, value: 0 });' \
  '  if (false) points.push({ timeSeconds: end, value: 0 });' \
  "$ENVFID"

probe "43 · the source is cut at the onset rather than fading through it" "$SHIFT" \
  '      durationSeconds: envelope.endSeconds,' \
  '      durationSeconds: round(handover),' \
  "$SLIDEFID"

probe "44 · the tail ends on a level instead of on silence" "$ENVELOPE" \
  '  if (end > handover) points.push({ timeSeconds: end, value: 0 });' \
  '  if (end > handover) points.push({ timeSeconds: end, value: gainAtTargetOnset });' \
  "$ENVFID"

probe "45 · the overlap loses its lower bound and collapses" "$ENVELOPE" \
  'export const MIN_OVERLAP_SECONDS = 0.012;' \
  'export const MIN_OVERLAP_SECONDS = 0;' \
  "$ENVFID"

probe "46 · the overlap loses its ceiling and smears the next note" "$ENVELOPE" \
  'export const MAX_OVERLAP_SECONDS = 0.045;' \
  'export const MAX_OVERLAP_SECONDS = 9;' \
  "$ENVFID"

probe "47 · a short note is no longer protected from being buried" "$ENVELOPE" \
  'export const MAX_OVERLAP_FRACTION = 0.35;' \
  'export const MAX_OVERLAP_FRACTION = 9;' \
  "$ENVFID"

probe "48 · the strings of a shape stop sharing a ceiling" "$ENVELOPE" \
  'export const MAX_SOURCE_SUM = 1.4;' \
  'export const MAX_SOURCE_SUM = 99;' \
  "$ENVFID"

echo "── the handoff stops being sample-aware (2V-C.4 §5) ──"
probe "49 · one number is applied to every recording again" "$ENVELOPE" \
  '  const wanted = input.targetAttackSeconds + SOURCE_RELEASE_SECONDS;' \
  '  const wanted = 0.02;' \
  "$ENVFID"

probe "50 · the arrival level stops moving with the attack" "$ENVELOPE" \
  '  const lean = clamp(input.targetAttackSeconds / span, 0, 1);' \
  '  const lean = 0;' \
  "$ENVFID"

probe "51 · the attack table loses the range that makes it worth having" "$ONSET" \
  '    A3: 0.031,' \
  '    A3: 0.003,' \
  "$ONSETFID"

probe "52 · the playback rate is dropped from the attack lookup" "$ONSET" \
  '  return rate > 0 ? attack / rate : attack;' \
  '  return attack;' \
  "$ONSETFID"

probe "53 · a shape releases one string before another" "$SHIFT" \
  '      targetAttackSeconds: group?.attack ?? attackFor(link.targetIndex),' \
  '      targetAttackSeconds: attackFor(link.targetIndex),' \
  "$SLIDEFID"

probe "54 · the tail slides past the pitch it arrived at" "$SHIFT" \
  '        cents: round(climb),' \
  '        cents: round(climb * 1.1),' \
  "$PLAYBACK"

echo "── the PCM analyzer stops measuring (2V-C.4 §3, §4) ──"
probe "55 · silence is only counted, never measured in seconds" "$SEAMPCM" \
  '  if (seam.silentSeconds > maxSilent) {' \
  '  if (false) {' \
  "$SEAMFID"

probe "56 · a deep dip that never reaches silence is let through" "$SEAMPCM" \
  '  if (seam.valleyRatio < minValley) {' \
  '  if (false) {' \
  "$SEAMFID"

probe "57 · a spliced discontinuity stops being a click" "$SEAMPCM" \
  '  if (seam.maxStep > maxStep) {' \
  '  if (false) {' \
  "$SEAMFID"

probe "58 · an entirely silent window is accepted as continuous" "$SEAMPCM" \
  '  if (seam.beforeMedianRms <= SILENCE_FLOOR && seam.afterMedianRms <= SILENCE_FLOOR) {' \
  '  if (false) {' \
  "$SEAMFID"

probe "59 · the connected floor drops below an unconnected re-strike" "$SEAMPCM" \
  '  connected: { minValleyRatio: 0.2 },' \
  '  connected: { minValleyRatio: 0.05 },' \
  "$SEAMFID"

probe "60 · the re-strike reference is given a floor it can be tuned to" "$SEAMPCM" \
  '  restrike: { minValleyRatio: 0 },' \
  '  restrike: { minValleyRatio: 0.2 },' \
  "$SEAMFID"

echo "── the fixtures stop covering what the report says (2V-C.4 §4, §12) ──"
probe "61 · the written rest is quietly filled in" "$SEAMFX" \
  '    if (recipe.restBetween === true && tie < lastOnset) continue;' \
  '    if (false) continue;' \
  "$SEAMFXFID"

probe "62 · the sustain control goes back to a note one slot long" "$SEAMFX" \
  '  for (let tie = 1; tie < RESOLUTION; tie += 1) {' \
  '  for (let tie = spacing + 1; tie < RESOLUTION; tie += 1) {' \
  "$SEAMFXFID"

probe "63 · the practice fixtures claim a rate the render never sees" "$SEAMFX" \
  '    ...(recipe.practicePercent === undefined
      ? {}
      : { practicePercent: recipe.practicePercent }),' \
  '    ...({}),' \
  "$SEAMFXFID"

probe "64 · a quick recording gets no handover at all" "$PRESETS" \
  '    handoverGainFraction: 0.45,' \
  '    handoverGainFraction: 0.02,' \
  "$ENVFID"

# Joined by walking the array. An earlier version pasted the rows together
# and then split on every comma, which put a line break inside the first
# probe name that happened to contain one and produced unparseable JSON.
{
  printf '{\n  "generatedAt": "%s",\n  "sha": "%s",\n  "passed": %d,\n  "failed": %d,\n  "probes": [\n' \
    "$(date -u +%FT%TZ)" "$(git rev-parse HEAD)" "$PASSED" "$FAILED"
  for i in "${!ROWS[@]}"; do
    if [ "$i" -eq $(( ${#ROWS[@]} - 1 )) ]; then
      printf '    %s\n' "${ROWS[$i]}"
    else
      printf '    %s,\n' "${ROWS[$i]}"
    fi
  done
  printf '  ]\n}\n'
} > "$RESULTS"

echo
echo "$PASSED red · $FAILED not red · results in $RESULTS"
[ "$FAILED" -eq 0 ]
