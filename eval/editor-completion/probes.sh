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

echo
echo "$pass red · $fail did not"
[ "$fail" -eq 0 ] || exit 1
