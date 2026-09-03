#!/usr/bin/env bash
#
# Serial mutation probes for the invariants this batch added (2V-B.4 §19).
#
# Each one breaks exactly one thing in the source, runs the test that is
# supposed to notice, and restores the file. A probe that stays green is a
# test that was not testing anything, which is the only way to tell a real
# guard from a sentence about one. Serial on purpose: these edit the tree.
set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0; fail=0

probe() {
  local name="$1" file="$2" from="$3" to="$4" spec="$5" pattern="$6"
  cp "$file" "$file.probe-bak"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if old not in text:
    print("PROBE-SETUP-FAILED: pattern absent")
    sys.exit(3)
open(path, "w").write(text.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then
    echo "SETUP-FAIL  $name"; fail=$((fail+1)); mv "$file.probe-bak" "$file"; return
  fi
  local out
  out=$(npx vitest run "$spec" -t "$pattern" 2>&1)
  mv "$file.probe-bak" "$file"
  if echo "$out" | grep -qE "[1-9][0-9]* failed"; then
    echo "RED         $name"; pass=$((pass+1))
  else
    echo "STAYED-GREEN  $name  <-- the guard does not guard"; fail=$((fail+1))
  fi
}

probe "the selection hue is declared" \
  src/app/globals.css "--color-accent: #7fa7b8;" "--color-accent-unused: #7fa7b8;" \
  src/lib/tab/phrase-band.test.ts "names the selection hue"

probe "the phrase never wears the ghost's bronze" \
  src/components/workspace/PhraseBand.tsx "border-accent text-accent font-semibold" "border-bronze text-bronze font-semibold" \
  src/lib/tab/phrase-band.test.ts "keeps the phrase quieter"

probe "the chord repeats the write's own refusal" \
  src/components/workspace/shelf/ChordPanel.tsx "refusal: written.error.message" 'refusal: "Bu süre buraya sığmıyor"' \
  src/components/workspace/shelf/ChordPanel.test.ts "passes the write's sentence through"

probe "the chord length carries both registers" \
  src/components/workspace/shelf/ChordPanel.tsx "{length.plain} · {length.technical}" "{length.plain}" \
  src/components/workspace/shelf/ChordPanel.test.ts "shows both registers together"

probe "a span option never shows a raw number" \
  src/lib/chords/chord-span.ts 'this_beat: "Bu vuruş"' 'this_beat: "Bu vuruş (1/4)"' \
  src/components/workspace/shelf/ChordPanel.test.ts "offers the four intentions"

probe "transposition leaves the kit alone" \
  src/lib/song/transpose.ts "if (isDrumSlotArray(lane)) continue;" "if (false) continue;" \
  src/lib/song/transpose-acceptance.test.ts "leaves every drum hit"

probe "a lattice bar is still read as the grid it had" \
  src/lib/music/timing.ts "if (bar.notation !== undefined) return bar.notation as OfferedResolution;" "if (bar.notation !== undefined) return bar.resolution as OfferedResolution;" \
  src/lib/song/mixed-rhythm.test.ts "the reader is never shown"

probe "the slide's travel time is never a number" \
  src/lib/music/duration-language.ts 'export const SLIDE_TRAVEL = "Otomatik";' 'export const SLIDE_TRAVEL = "120 ms";' \
  src/lib/music/duration-language.test.ts "keeps the slide's travel automatic"

# --------------------------------------------------- 2V-C.1 guitar gestures

probe "the four bends really end differently" \
  src/lib/audio/pitch-gesture.ts "return kind === \"bend_release\" || kind === \"prebend_release\";" "return true;" \
  src/lib/audio/pitch-gesture.test.ts "bend rises from the written pitch and stays up"

probe "a prebend starts already bent" \
  src/lib/audio/pitch-gesture.ts "if (startsBent(gesture.kind)) {" "if (false) {" \
  src/lib/audio/pitch-gesture.test.ts "prebend is already there"

probe "vibrato waits for the target" \
  src/lib/audio/pitch-gesture.ts "const from = reachedAt + delay;" "const from = 0;" \
  src/lib/audio/pitch-gesture.test.ts "reaches the target before it starts moving"

probe "a legacy bend keeps its own path" \
  src/lib/audio/expression-plan.ts "if (resolved.pitch?.source === \"gesture\") {" "if (resolved.pitch !== null) {" \
  src/lib/audio/legacy-expression.test.ts "bends half and full to exactly"

probe "one axis answered twice is refused" \
  src/lib/music/expression-resolver.ts "if (note.pitchGesture !== undefined && legacyPitch !== undefined) {" "if (false) {" \
  src/lib/music/expression-resolver.test.ts "refuses two answers on one axis"

probe "the shift slide is struck and the legato one is not" \
  src/lib/audio/legato-chain.ts "if (restrikesTarget(resolved.connection)) return null;" "" \
  src/lib/audio/gesture-playback.test.ts "leaves the shift slide an ordinary onset"

probe "a resumed voice is read from its own automation" \
  src/lib/audio/active-voices.ts "currentCents: cents," "currentCents: 0," \
  src/lib/audio/gesture-playback.test.ts "is still up when the transport is paused"

probe "the slide reads the sounding pitch, not the fret" \
  src/lib/song/gesture-write.ts "if (interval === 0) return fail(\"no_direction\");" "" \
  src/lib/song/gesture-write.test.ts "refuses two frets that sound the same"

probe "a slide across silence is refused" \
  src/lib/song/gesture-write.ts "if (slot === undefined || slot === null) return \"silence\";" "if (slot === undefined || slot === null) continue;" \
  src/lib/song/gesture-write.test.ts "refuses a slide across real silence"

probe "the shift slide is marked as the one that is struck" \
  src/lib/music/gesture-language.ts "return { mark: \`s\${lean}\`, spoken: \"önceki notadan kaydır ve yeniden vur\" };" "return { mark: lean, spoken: \"önceki notadan kaydır ve yeniden vur\" };" \
  src/lib/music/gesture-language.test.ts "marks the shift slide as the one"

probe "L11's two sides really differ" \
  src/lib/listening/gesture-take.ts "L11b: { ...HOLD, pitchGesture: { kind: \"bend_release\", targetCents: 200 } }," "L11b: { ...HOLD, pitchGesture: { kind: \"bend\", targetCents: 200 } }," \
  src/lib/listening/gesture-take.test.ts "holds versus releases"

probe "a transposed note carries its gestures with it" \
  src/lib/song/transpose.ts "      ...note,
      pitch," "      pitch," \
  src/lib/song/transpose-acceptance.test.ts "keeps the bend"

echo
echo "$pass red · $fail did not"
[ "$fail" -eq 0 ] || exit 1
