#!/usr/bin/env bash
# Vacuity probes for 2J.
#
# Each probe breaks one guarantee and asserts that a named test actually goes
# red. A test that stays green is testing nothing, and this is the only way to
# find that out.
#
# Six run against the unit suite. Six need the real browser, because what they
# guard — which engine is running, which scroller is live, what a tap seeks to
# — is not visible from a unit test at all.
set -u

pass=0; fail=0
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
  if [ $? -ne 0 ]; then echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"; return; fi

  if eval "$cmd" >/dev/null 2>&1; then
    echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
  else
    echo "RED   $name"; pass=$((pass+1))
  fi
  mv "$file.probebak" "$file"
}

U="npx vitest run src/lib/arrangement"

# 1 — the grid must not reach the width
probe "1 resolution changes bar width" \
  src/lib/arrangement/geometry.ts \
  '  return Math.round(barWholeNotes(timeSignature, resolution) * PX_PER_WHOLE);' \
  '  return Math.round(barWholeNotes(timeSignature, resolution) * PX_PER_WHOLE * (resolution / 8));' \
  "$U"

# 2 — nor may the tempo
probe "2 tempo changes pixel width" \
  src/lib/arrangement/model.ts \
  '      const width = arrangementBarWidth(bar.timeSignature, bar.resolution);' \
  '      const width = Math.round(arrangementBarWidth(bar.timeSignature, bar.resolution) * (song.bpm / 120));' \
  "$U"

# 3 — silence is not a repeat of silence
probe "3 a silent bar counts as a repeat" \
  src/lib/arrangement/digest.ts \
  '  if (isSilentCell(bar, trackId)) return null;' \
  '  if (isSilentCell(bar, trackId)) return "silent";' \
  "$U"

# 4 — how hard a note is hit is part of the bar
probe "4 velocity dropped from the digest" \
  src/lib/arrangement/digest.ts \
  '        note.velocity ?? "null",
        note.articulation ?? "null",' \
  '        note.articulation ?? "null",' \
  "$U"

# 5 — a section seam is not a rest
probe "5 tie cut at a section boundary" \
  src/lib/arrangement/links.ts \
  '    if (bar.spans.some((span) => span.openEnd)) add(bar.key, next.key, "tie");' \
  '    if (bar.sectionId !== next.sectionId) return;
    if (bar.spans.some((span) => span.openEnd)) add(bar.key, next.key, "tie");' \
  "$U"

# 6 — but a bar the track is not written in *is* silence
probe "6 missing track key does not cut the carry" \
  src/lib/tab/timeline.ts \
  '    const continues = nextSlots !== undefined && nextSlots[0] === "-";' \
  '    const continues = nextSlots === undefined || nextSlots[0] === "-";' \
  "$U"

echo
echo "unit probes: $pass red, $fail vacuous"
