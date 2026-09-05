#!/usr/bin/env bash
# Corruptions of this round's fixes, each required to go red (2V-D.1-C §19).
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
# Usage:  eval/technique-spans/probes.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT="eval/technique-spans/artifacts"
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


TIMELINE=src/lib/tab/timeline.ts
LEGATO=src/lib/music/legato.ts
PLAN=src/lib/audio/expression-plan.ts
RECT=src/lib/music/span-rect.ts
SPANTX=src/lib/song/span-transform.ts
TRANSFORM=src/lib/song/transform.ts
MARKS=src/lib/tab/expression-marks.ts
GEOM=src/lib/tab/technique-geometry.ts
GLYPH=src/lib/tab/glyph-model.ts
SURFACE=src/lib/song/technique-surface.ts
SECTION=src/components/workspace/TechniqueSection.tsx
MESSAGES=src/lib/export/export-messages.ts
SCOPE=src/lib/listening/listening-scope.ts
TAKE=src/lib/listening/gesture-take.ts

PMTIME=eval/technique-spans/pm-timeline.test.ts
PLAYBACK=src/lib/audio/technique-span-playback.test.ts
RECTT=src/lib/music/span-rect.test.ts
SPANTXT=src/lib/song/span-transform.test.ts
LIFE=src/lib/audio/span-lifecycle.test.ts
MARKST=src/lib/tab/expression-marks.test.ts
SURFACET=src/lib/song/technique-surface.test.ts
UIT=src/lib/workspace/technique-ui-boundary.test.ts
EXPORTT=src/lib/export/span-export.test.ts
FOUNDER=src/lib/listening/founder-authority.test.ts
TAKET=src/lib/listening/gesture-take.test.ts

echo "── the palm mute is gated once, and the two writings agree (§2) ──"

# The exact shape of the defect: the timeline stops resolving the technique,
# so a span becomes invisible to the tick gate and the planner gates it again.
probe "1 · the timeline stops seeing a span's technique" "$TIMELINE" \
  '          return held.length === 0 ? {} : { techniques: held };' \
  '          return {};' \
  "$PMTIME"

probe "2 · the tick gate reads the legacy enum only" "$LEGATO" \
  '  if (span.techniques?.includes("palm_mute") === true) {
    return articulationHold("palm_mute");
  }' \
  '  if (false) {
    return articulationHold("palm_mute");
  }' \
  "$PLAYBACK"

probe "3 · the planner gates the span a second time" "$PLAN" \
  '  const held = palmMuteSeconds(durationSeconds * (attackLayer?.holdFraction ?? 1));' \
  '  const held = palmMuteSeconds(durationSeconds * 0.45 * (attackLayer?.holdFraction ?? 1));' \
  "$PLAYBACK"

probe "4 · the absolute mute ceiling stops binding at all" "$PLAN" \
  '  return round(Math.min(durationSeconds, expressionPresets.palmMute.maxHoldSeconds));' \
  '  return round(durationSeconds);' \
  "$PLAYBACK"

probe "5 · a span no longer chooses the mute filter" "$PLAN" \
  '      gainEnvelope: palmMuteGain(held, level),
      filterPreset: "palm_mute",' \
  '      gainEnvelope: palmMuteGain(held, level),' \
  "$PLAYBACK"

echo "── the rectangle algebra (§3) ──"

probe "6 · subtraction drops the strings it did not cut" "$RECT" \
  '  if (untouched.length > 0) {' \
  '  if (false && untouched.length > 0) {' \
  "$RECTT"

probe "7 · subtraction keeps only the left piece" "$RECT" \
  '  if (meeting.endTicks < a.endTicks) {' \
  '  if (false && meeting.endTicks < a.endTicks) {' \
  "$RECTT"

probe "8 · touching ranges count as overlapping" "$RECT" \
  '  if (endTicks <= startTicks) return null;' \
  '  if (endTicks < startTicks) return null;' \
  "$RECTT"

# `continue` alone is not the defect: the length guard below catches it and the
# refusal still happens, which is the second guard doing its job. Keeping the
# old index is what makes the span quietly cover a string it should have lost.
probe "9 · a string with nowhere to go keeps its old one" "$RECT" \
  '    if (next === null) return null;' \
  '    if (next === null) { moved.push(index); continue; }' \
  "$RECTT"

probe "10 · two strings collapsing onto one is accepted" "$RECT" \
  '  if (unique.length !== rect.stringIndices.length) return null;' \
  '  if (false) return null;' \
  "$RECTT"

probe "11 · normalize merges neighbours after all" "$RECT" \
  '    const key = `${rect.startTicks}-${rect.endTicks}:${strings.join("/")}`;' \
  '    const key = `${strings.join("/")}`;' \
  "$RECTT"

probe "12 · a span reaching past its section is called fine" "$RECT" \
  '  if (span.startTicks < 0 || span.endTicks > owner.sectionTicks) {' \
  '  if (span.startTicks < 0) {' \
  "$RECTT"

probe "13 · a fragment loses the reader's own identity" "$RECT" \
  '  return index === 0 ? span.id : `${span.id}~${index}`;' \
  '  return `${span.id}~${index}`;' \
  "$RECTT"

probe "14 · a copy keeps the original's identity" "$RECT" \
  '  return `${span.id}+${seed}${index === 0 ? "" : `~${index}`}`;' \
  '  return span.id;' \
  "$RECTT"

probe "15 · a split loses the section it landed in" "$RECT" \
  '      rect: translate(overlap, -section.startTicks),' \
  '      rect: overlap,' \
  "$RECTT"

echo "── copy, move, repeat, delete, restring (§4–§8) ──"

probe "16 · a copy carries no span at all" "$TRANSFORM" \
  '    clipboard: spans.length === 0 ? clipboard : { ...clipboard, spans },' \
  '    clipboard,' \
  "$SPANTXT"

probe "17 · delete removes the whole span, not the region" "$SPANTX" \
  '    const pieces = normalize(subtract(rectOf(span), window));' \
  '    const pieces: readonly SpanRect[] = [];' \
  "$SPANTXT"

probe "18 · delete takes another track's spans with it" "$SPANTX" \
  '    if (span.trackId !== region.trackId) {
      out.push(span);
      continue;
    }
    const pieces = normalize' \
  '    if (span.trackId !== region.trackId) {
      continue;
    }
    const pieces = normalize' \
  "$SPANTXT"

probe "19 · a paste trims a span instead of refusing" "$SPANTX" \
  '    if (startTicks < 0 || endTicks > input.sectionTicks) {
      return { ok: false, fault: "span_out_of_section" };
    }' \
  '    if (false) {
      return { ok: false, fault: "span_out_of_section" };
    }' \
  "$SPANTXT"

probe "20 · two pastes of one clipboard share an id" "$SPANTX" \
  '    added.push({ ...source, id: freeId(copyId(source, input.seed, index), taken) });' \
  '    added.push({ ...source, id: source.id });' \
  "$SPANTXT"

probe "21 · a move leaves the span where it was" "$SPANTX" \
  '    const moved = translate(meeting, input.deltaTicks);' \
  '    const moved = meeting;' \
  "$SPANTXT"

probe "22 · a move pushes a span out of its section" "$SPANTX" \
  '    if (moved.startTicks < 0 || moved.endTicks > input.sectionTicks) {
      return { ok: false, fault: "span_out_of_section" };
    }' \
  '    if (false) {
      return { ok: false, fault: "span_out_of_section" };
    }' \
  "$SPANTXT"

probe "23 · a restring moves the notes and leaves the span" "$TRANSFORM" \
  '      const spans = remapRegion(spansNow, regionOver(grown.startTicks, grown.endTicks), {
        stringDelta: command.stringDelta,
        stringCount,
      });
      if (!spans.ok) return spanFail(spans.fault);
      return finish(canvas, grown, spans.spans);
    }

    case "translate_fret_shape": {' \
  '      return finish(canvas, grown);
    }

    case "translate_fret_shape": {' \
  "$SPANTXT"

probe "24 · a restring covers one string fewer, quietly" "$SPANTX" \
  '    if (!moved) return { ok: false, fault: "span_string_missing" };' \
  '    if (!moved) { out.push(span); continue; }' \
  "$SPANTXT"

probe "25 · a repeat writes one span for every copy" "$TRANSFORM" \
  '        spans = copied.spans;' \
  '        void copied;' \
  "$SPANTXT"

probe "26 · the last span leaves an empty array behind" "$SPANTX" \
  '    delete bare.techniqueSpans;' \
  '    void bare;' \
  "$SPANTXT"

echo "── the resume, the loop and the plan (§10) ──"

probe "27 · a paused mute comes back open" "src/lib/audio/active-voices.ts" \
  '    ...(note.filterPreset === undefined ? {} : { filterPreset: note.filterPreset }),' \
  '    ...({}),' \
  "$LIFE"

probe "28 · a selection restores a voice it never started" "src/lib/audio/active-voices.ts" \
  '    onsetTicks >= window.startTicks &&' \
  '    true &&' \
  "$LIFE"

echo "── the page (§11) ──"

probe "29 · the digit forgets the explicit attack axis" "$GLYPH" \
  '  return printedFret(fret, attack ?? legacyPrinted(articulation));' \
  '  return printedFret(fret, legacyPrinted(articulation));' \
  "$MARKST"

probe "30 · a span-held mute draws no rail" "$GEOM" \
  '  if (span.techniques?.includes(kind) === true) return true;' \
  '  if (false) return true;' \
  "$MARKST"

probe "31 · let ring loses the rail it just gained" "$GEOM" \
  '  const letRings = buildRails(bar, layout, legato, "let_ring");' \
  '  const letRings: TechniqueRail[] = [];' \
  "$MARKST"

probe "32 · an attack is written on the digit and beside it" "$MARKS" \
  '  if (!attack || ON_DIGIT.has(attack)) return null;' \
  '  if (!attack) return null;' \
  "$MARKST"

probe "33 · the two picking strokes get the same mark" "$MARKS" \
  '  { id: "picking_up", glyph: "V", spoken: "yukarı vuruş", place: "beside" },' \
  '  { id: "picking_up", glyph: "⊓", spoken: "yukarı vuruş", place: "beside" },' \
  "$MARKST"

echo "── the Çalım surface (§12–§14) ──"

probe "34 · a group opens on a choice that writes something" "$SURFACE" \
  '      { value: null, label: "Normal", hint: "Özel bir şey yok." },' \
  '      { value: "accent", label: "Vurgulu", hint: "Diğerlerinden daha sert." },' \
  "$SURFACET"

probe "35 · a label goes back to being an identifier" "$SURFACE" \
  '        label: "Avuç susturma",' \
  '        label: "palm_mute span",' \
  "$SURFACET"

probe "36 · the picking disclosure stops saying it is silent" "$SURFACE" \
  '  "Pena yönü nota üzerinde yazılır ve çalarken duyulmaz: elindeki hareketi " +
  "not eder, sesi değiştirmez.";' \
  '  "Pena yönü nota üzerinde yazılır.";' \
  "$SURFACET"

probe "37 · a region stops covering the whole bar" "$SURFACE" \
  '    endTicks: barStart + barLength,' \
  '    endTicks: barStart + step,' \
  "$SURFACET"

probe "38 · the preview stops running the command it previews" "$SURFACE" \
  '  const result = runTechnique(song, scope, group, value);
  if (result === null) return NOTHING_CHOSEN;
  if (!result.ok) return result.message;' \
  '  const result = runTechnique(song, scope, group, value);
  if (result === null) return NOTHING_CHOSEN;' \
  "$SURFACET"

probe "39 · a region mark under another string is listed here" "$SURFACE" \
  '        span.stringIndices.includes(scope.stringIndex),' \
  '        true,' \
  "$SURFACET"

probe "40 · the surface starts covering the music" "$SECTION" \
  '    <div className="border-line border-t pt-3" data-technique-section>' \
  '    <div className="fixed inset-0 z-30 border-line border-t pt-3" data-technique-section>' \
  "$UIT"

probe "41 · the choices lose their thumb-sized target" "$SECTION" \
  '      style={{ minHeight: MIN_TOUCH_TARGET_PX }}' \
  '      style={{ minHeight: 20 }}' \
  "$UIT"

probe "42 · a region mark can no longer be removed" "$SECTION" \
  '                data-technique-remove={region.id}' \
  '                data-region-remove={region.id}' \
  "$UIT"

echo "── export honesty (§15) ──"

probe "43 · MIDI stops naming what it drops" "$MESSAGES" \
  '"MIDI notaları ve zamanlamayı taşır. Bend, slide, vibrato, vuruş sertliği " +
  "ve avuç susturma gibi çalım ayrıntıları başka programlarda aynı " +
  "duyulmayabilir."' \
  '"MIDI notaları ve zamanlamayı taşır."' \
  "$EXPORTT"

probe "44 · the export forgets that picking is not heard" "$MESSAGES" \
  '  "Pena yönü nota üzerinde yazılır ve çalarken duyulmaz: elindeki hareketi " +
  "not eder, sesi değiştirmez.";' \
  '  "Pena yönü çalarken duyulur.";' \
  "$EXPORTT"

echo "── the listening round (§18) ──"

probe "45 · the round closes itself again" "$SCOPE" \
  'export const ACTIVE_CLIP_IDS = ["L27", "L28", "L29"] as const;' \
  'export const ACTIVE_CLIP_IDS = [] as const;' \
  "$FOUNDER"

probe "46 · the parity card's two sides become the same writing" "$TAKE" \
  '  L27b: { ...HOLD, span: { kind: "palm_mute", strings: [STRING] } },' \
  '  L27b: { ...HOLD, legacyMute: true },' \
  "$TAKET"

probe "47 · the harmonic card loses its harmonic" "$TAKE" \
  '    attack: "natural_harmonic",' \
  '' \
  "$TAKET"

probe "48 · the region card mutes both strings" "$TAKE" \
  '    span: { kind: "palm_mute", strings: [STRING] },' \
  '    span: { kind: "palm_mute", strings: [STRING, STRING + 1] },' \
  "$TAKET"

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
