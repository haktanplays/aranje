#!/usr/bin/env bash
# Vacuity probes for 2J.1.
#
# Each probe breaks one guarantee and asserts that a named test actually goes
# red. A test that stays green is testing nothing, and this is the only way to
# find that out.
#
# Eight run against the unit suite. Six need the real browser, because what
# they guard — which gesture starts which selection, what a preview writes,
# whether a stale seek survives a structural edit — is invisible from a unit
# test.
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

U="npx vitest run src/lib/song/bar-transform.test.ts"

# 1 — a track delete may never remove the bar
probe "1 a track delete removes the whole bar" \
  src/lib/song/bar-transform.ts \
  '        return {
          ok: true,
          song: withBars(
            song,
            selection.sectionId,
            clearTrackRange(section, selection.trackId, start, end),
          ),
          selection,
          warnings: [],
          notice,
        };' \
  '' \
  "$U"

# 2 — a section may never reach zero bars
probe "2 the last bar of a section can be deleted" \
  src/lib/song/bar-transform.ts \
  '      if (section.bars.length - length < 1) {' \
  '      if (false) {' \
  "$U"

# 3 — the target keeps its own grid on a content paste
probe "3 a content paste takes the source grid" \
  src/lib/song/bar-transform.ts \
  '  return { ok: true, bar: { ...target, slots } };' \
  '  return { ok: true, bar: { ...target, resolution: source.resolution, timeSignature: source.timeSignature, slots } };' \
  "$U"

# 4 — a moment the target grid cannot write is refused, never rounded
probe "4 a mixed grid is rounded silently" \
  src/lib/song/bar-regrid.ts \
  '    if (run.durationTicks % toStep !== 0) return null;' \
  '    if (false) return null;' \
  "$U"

# 5 — overwriting is a decision the reader makes
#
# Anchored on the condition alone: the message around it carries typographic
# quotes, and matching them exactly in a shell heredoc is a fight with no prize.
# `probe` replaces the first occurrence, which is the track-scope branch.
probe "5 a collision overwrites without asking" \
  src/lib/song/bar-transform.ts \
  'if (!command.replace && rangeHasContent(section, selection)) {' \
  'if (false) {' \
  "$U"

# 6 — a selection may not cut a chain in half
probe "6 chain expansion is dropped" \
  src/lib/song/bar-selection.ts \
  '        if (from.barIndex < start) {
          start = from.barIndex;
          grew = true;
        }' \
  '' \
  "$U"

# 7 — a chain leaving the section is refused, not silently taken
probe "7 a cross-section chain is accepted" \
  src/lib/song/bar-selection.ts \
  '        if (from.sectionId !== selection.sectionId) {
          return { ok: false, error: crossesSection };
        }' \
  '' \
  "$U"

# 8 — a blank bar writes no track keys
probe "8 a blank bar invents track keys" \
  src/lib/song/bar-transform.ts \
  '    // No track keys at all: a missing key is silence for every track (5.5).
    slots: {},' \
  '    slots: { gtr: [] },' \
  "$U"

# 9 — a drum lane is a track, and its content actually travels
#
# The drum branch is what the old tick-based track scope could not express at
# all, so this is the probe that would have been green before the rewrite.
probe "9 a drum bar travels as silence" \
  src/lib/song/bar-transform.ts \
  '  const regridded = isDrumSlotArray(slots)
    ? regridDrums(slots, source.resolution, target.resolution, toCount)
    : regridMelodic(slots, source.resolution, target.resolution, toCount);' \
  '  const regridded = isDrumSlotArray(slots)
    ? undefined
    : regridMelodic(slots, source.resolution, target.resolution, toCount);' \
  "$U"

# 10 — a bar the track was never written in is somewhere content can land
probe "10 an empty bar cannot be written into" \
  src/lib/song/bar-transform.ts \
  '  if (at < 0 || at + sources.length > bars.length) {' \
  '  if (true) {' \
  "$U"

# 11 — what has to stop playback, and what must not
probe "11 every command counts as structural" \
  src/lib/song/bar-transform.ts \
  '  if (scope !== "full") return false;' \
  '  if (scope !== "full") return true;' \
  "$U"

# 12 — a position held across a song change lands on a bar that exists
probe "12 the playhead is never clamped" \
  src/lib/audio/position.ts \
  '  const index = Number.isInteger(wanted)
    ? Math.min(Math.max(0, wanted), pool.length - 1)
    : 0;' \
  '  const index = Number.isInteger(wanted) ? wanted : 0;' \
  "npx vitest run src/lib/audio/position.test.ts"

echo
echo "unit probes: $pass red, $fail vacuous"
