#!/usr/bin/env bash
#
# 2T-B §14. Twenty-five mutations, each of which must turn one named test red.
#
# A green suite says nothing on its own: it is equally consistent with the code
# being right and with the tests never having looked. Each probe below breaks
# one specific claim and names the test that has to notice. A probe that stays
# green is not a passing probe — it is a test that was not measuring anything,
# and it gets replaced rather than explained away.
#
# Usage:  bash eval/score-truth/probes.sh            (all)
#         ONLY=P03,P11 bash eval/score-truth/probes.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0; fail=0; results=()

probe() {
  local id="$1" file="$2" find="$3" replace="$4" test_file="$5" test_name="$6"
  if [ -n "${ONLY:-}" ] && [[ ",${ONLY}," != *",${id},"* ]]; then return; fi

  local backup; backup="$(mktemp)"
  cp "$file" "$backup"
  # Fixed-string replacement, so a mutation cannot silently miss.
  if ! python3 - "$file" "$find" "$replace" <<'PY'
import sys
path, find, replace = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if find not in text:
    sys.exit(2)
open(path, "w").write(text.replace(find, replace, 1))
PY
  then
    cp "$backup" "$file"; rm -f "$backup"
    results+=("$id  NOT-APPLIED  $file")
    fail=$((fail + 1)); return
  fi

  local out; out="$(npx vitest run "$test_file" -t "$test_name" 2>&1)"
  cp "$backup" "$file"; rm -f "$backup"

  # A filter that matched nothing reports no failures, which reads exactly
  # like a passing probe and is the opposite of one. Checked first.
  if grep -qE "Tests +[0-9]+ skipped" <<<"$out" || ! grep -q "Tests " <<<"$out"; then
    results+=("$id  NO-TEST-RAN   $test_name")
    fail=$((fail + 1))
  elif grep -q "Tests .*failed" <<<"$out"; then
    results+=("$id  RED         $test_name")
    pass=$((pass + 1))
  else
    results+=("$id  STAYED-GREEN  $test_name")
    fail=$((fail + 1))
  fi
}

SOUND=src/lib/song/sounding.ts
EXTENT=src/lib/tab/span-extent.ts
TAIL=src/lib/tab/rhythm-tail.ts
RETUNE=src/lib/song/retune-harmony.ts
DRAG=src/lib/song/duration-drag.ts
DURATION=src/lib/song/note-duration.ts
TIMELINE=src/lib/tab/timeline.ts
FIXTURES=src/lib/repertoire/fixtures.ts

# ---- what a string can physically do -------------------------------------
probe P01 "$SOUND" \
  'const ringsOn = span.note.letRing === true && !span.explicit;' \
  'const ringsOn = span.note.letRing === true;' \
  src/lib/song/sounding.test.ts "does not stretch a length the note stated for itself"

probe P02 "$SOUND" \
  'if (claimed.has(claim)) {' 'if (false) {' \
  src/lib/song/sounding.test.ts "refuses to sound two notes on one string at the same instant"

probe P03 "$SOUND" \
  'const soundingTicks = Math.min(wanted, room);' \
  'const soundingTicks = wanted;' \
  src/lib/song/sounding.test.ts "still ends a let-ring note when its own string is taken again"

probe P04 "$SOUND" \
  'const wanted = ringsOn ? Math.max(span.writtenTicks, room) : span.writtenTicks;' \
  'const wanted = span.writtenTicks;' \
  src/lib/song/sounding.test.ts "rings past a global onset on another string when it has no written length"

probe P05 "$FIXTURES" \
  'const endTicks = retaken.has(voice.string) ? restrikeTicks : 768;' \
  'const endTicks = 768;' \
  src/lib/repertoire/fixtures.test.ts "never sounds two voices on one string at the same time"

# ---- ticks to slots -------------------------------------------------------
probe P06 "$EXTENT" \
  'const endTicks = startTicks + Math.max(soundingTicks, 1);' \
  'const endTicks = startTicks + soundingTicks;' \
  src/lib/tab/span-extent.test.ts "still gives a slot to a note that is heard for nothing"

probe P07 "$EXTENT" \
  'const endSlot = Math.max(startSlot, Math.ceil((to - barStart) / step) - 1);' \
  'const endSlot = Math.max(startSlot, Math.floor((to - barStart) / step) - 1);' \
  src/lib/tab/span-extent.test.ts "gives a note that ends inside a slot that whole slot"

probe P08 "$EXTENT" \
  'openStart: from > startTicks,' 'openStart: false,' \
  src/lib/tab/span-extent.test.ts "splits across a bar line, counting each bar on its own grid"

# ---- the written rhythm ---------------------------------------------------
probe P09 "$TAIL" \
  'flags: kind === "rest" ? beams : 0,' 'flags: 0,' \
  src/lib/tab/rhythm-tail.test.ts "gives a rest no stem and no beam, but keeps its own hooks"

probe P10 "$TAIL" \
  "dots: value?.modifier === \"dotted\" ? 1 : 0," 'dots: 0,' \
  src/lib/tab/rhythm-tail.test.ts "marks a dotted eighth as dotted and still gives it one beam"

probe P11 "$TAIL" \
  'if (group.length <= 4) return null;' 'return null;' \
  src/lib/tab/rhythm-tail.test.ts "breaks the secondary beams of an over-long group at the half beat"

probe P12 "$TAIL" \
  'if (!contiguous || !sameBeat) flush();' 'if (!contiguous) flush();' \
  src/lib/tab/rhythm-tail.test.ts "breaks the beam at a beat line even when the notes are contiguous"

probe P13 "$TAIL" \
  'input.restSlots.filter((slot) => !sounding.has(slot) && slot < input.slotCount),' \
  'input.restSlots.filter((slot) => slot < input.slotCount),' \
  src/lib/tab/rhythm-tail.test.ts "does not write a rest under a note that is still sounding"

probe P14 "$TAIL" \
  'if (note.value?.modifier !== "triplet") flush();' \
  'if (false) flush();' \
  src/lib/tab/rhythm-tail.test.ts "brackets nothing at all when the notes are not triplets"

probe P15 "$TAIL" \
  'hook: first.slotIndex === group[0]?.slotIndex ? "right" : "left",' \
  'hook: "right",' \
  src/lib/tab/rhythm-tail.test.ts "hooks a second beam that only one of the pair carries"

probe P16 "$TAIL" \
  'const shortest = Math.min(...lengths);' \
  'const shortest = Math.max(...lengths);' \
  src/lib/tab/rhythm-tail.test.ts "takes the shortest voice and says the stack disagreed"

probe P17 "$TAIL" \
  'for (let slot = span.startSlot; slot <= span.endSlot; slot += 1) sounding.add(slot);' \
  'sounding.add(span.startSlot);' \
  src/lib/tab/rhythm-tail.test.ts "does not write a rest under a note that is still sounding"

# ---- harmony that keeps the ornaments -------------------------------------
probe P18 "$RETUNE" \
  'placed.set(event, placed.get(anchor)! + (event.midi - anchor.midi));' \
  'placed.set(event, placed.get(anchor)!);' \
  src/lib/song/retune-harmony.test.ts "keeps an upper-neighbour cell as x, x plus one, x"

probe P19 "$RETUNE" \
  'const interval = direct ?? nearestInterval(role.degree, to.intervals);' \
  'const interval = nearestInterval(role.degree, to.intervals);' \
  src/lib/song/retune-harmony.test.ts "maps a chord tone onto the same voice of the target voicing"

probe P20 "$RETUNE" \
  'kind: "unanchored_ornament",' 'kind: "voice_folded",' \
  src/lib/song/retune-harmony.test.ts "warns instead of snapping when an ornament has nothing to attach to"

probe P21 "$RETUNE" \
  'const pool = sameString.length > 0 ? sameString : structural;' \
  'const pool = structural;' \
  src/lib/song/retune-harmony.test.ts "prefers a structural note on the ornament's own string"

probe P22 "$RETUNE" \
  'if (!inverted(event.note.articulation, after)) continue;' \
  'continue;' \
  src/lib/song/retune-harmony.test.ts "warns rather than silently inverting a slur"

# ---- a finger on a length -------------------------------------------------
probe P23 "$DRAG" \
  'const steps = Math.round(deltaPx / slotWidthPx);' \
  'const steps = Math.trunc(deltaPx / slotWidthPx);' \
  src/lib/song/duration-drag.test.ts "rounds to the nearest step rather than truncating"

probe P24 "$DRAG" \
  'if (!dragChanged(drag)) return { ok: false, reason: "duration_out_of_range" };' \
  'if (false) return { ok: false, reason: "duration_out_of_range" };' \
  src/lib/song/duration-drag.test.ts "refuses a drag that did not move"

probe P25 "$DURATION" \
  'return span?.writtenTicks ?? slotTicksAt(song, target);' \
  'return slotTicksAt(song, target);' \
  src/lib/song/duration-drag.test.ts "starts from the tie run when the note states no length"

probe P26 "$TIMELINE" \
  'sliceSpan(flatBars, span.startTicks, span.soundingTicks)' \
  'sliceSpan(flatBars, span.startTicks, span.writtenTicks)' \
  src/lib/tab/timeline.test.ts "stops a long note where its own string is taken again"

printf '\n'
for line in "${results[@]}"; do printf '%s\n' "$line"; done
printf '\nred: %d   not-red: %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
