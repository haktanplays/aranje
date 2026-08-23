#!/usr/bin/env bash
# Vacuity probes for 2L-B — the unit-suite half.
#
# Each probe re-creates one way the lifecycle could quietly rot — a skipped
# validator, a random id, a duplicate that copies half, a delete that takes a
# neighbour with it — and asserts a named test actually goes red. The nine
# that guard browser-only behaviour live in browser-probes.sh.
set -u

pass=0; fail=0
probe() {
  local name="$1" file="$2" find="$3" repl="$4" cmd="$5"
  # A leftover backup means another probe run is touching this file. Two
  # runs racing over one source silently restore each other's mutation and
  # can leave a real edit behind, so this refuses rather than guesses.
  if [ -e "$file.probebak" ]; then
    echo "ABORT $name: $file.probebak exists — another probe run is in flight"
    exit 2
  fi
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

S="npx vitest run src/lib/song/song-lifecycle.test.ts"
SE="npx vitest run src/lib/song/section-lifecycle.test.ts"
T="npx vitest run src/lib/song/track-lifecycle.test.ts"
ST="npx vitest run src/lib/song/lifecycle-store.test.ts"
B="npx vitest run src/lib/workspace/workspace-boundary.test.ts"

# 1 — the one lifecycle gate stops running the validators (the template path
#     included: create_song judges its candidate through this same guard)
probe "1 the guard skips the validator chain" \
  src/lib/song/lifecycle-guard.ts \
  '  const issues = runValidators(parsed.data);
  if (hasErrors(issues)) return { ok: false, error: { code: failCode } };' \
  '  const issues = runValidators(parsed.data);
  void hasErrors;' \
  "$T"

# 2 — a clock sneaks into the id allocator
probe "2 ids carry a timestamp" \
  src/lib/song/lifecycle-ids.ts \
  '    const candidate = `${prefix}-${n}`;' \
  '    const candidate = `${prefix}-${Date.now()}-${n}`;' \
  "$S"

# 3 — a section duplicate copies only the first track
probe "3 section duplicate keeps one track" \
  src/lib/song/section-lifecycle.ts \
  '        bars: source.bars.map((bar) => ({ ...bar, slots: { ...bar.slots } })),' \
  '        bars: source.bars.map((bar) => {
          const first = Object.keys(bar.slots)[0];
          return { ...bar, slots: first !== undefined ? { [first]: bar.slots[first]! } : {} };
        }),' \
  "$SE"

# 4 — a missing key becomes a fake empty slot array on track duplicate
probe "4 missing keys turn into empty arrays" \
  src/lib/song/track-lifecycle.ts \
  '          const slots = bar.slots[source.id];
          if (slots === undefined) return bar;
          return { ...bar, slots: { ...bar.slots, [id]: slots } };' \
  '          const slots = bar.slots[source.id] ?? [];
          return { ...bar, slots: { ...bar.slots, [id]: slots } };' \
  "$T"

# 5 — reordering a section renames it on the way
probe "5 section reorder changes the id" \
  src/lib/song/section-lifecycle.ts \
  '      const sections = [...song.sections];
      const [moved] = sections.splice(index, 1);
      sections.splice(target, 0, moved!);' \
  '      const sections = [...song.sections];
      const [moved] = sections.splice(index, 1);
      sections.splice(target, 0, { ...moved!, id: `${moved!.id}-m` });' \
  "$SE"

# 6 — the last section becomes deletable
probe "6 the last section can be deleted" \
  src/lib/song/section-lifecycle.ts \
  '      if (song.sections.length <= 1) {
        return { ok: false, error: { code: "last_section_undeletable" } };
      }' \
  '' \
  "$SE"

# 7 — an unwritable meter/grid pair is accepted at the door
probe "7 an invalid meter and grid pair is accepted" \
  src/lib/song/section-lifecycle.ts \
  '      if (!isRepresentableGrid(command.timeSignature, command.resolution)) {
        return { ok: false, error: { code: "grid_not_representable" } };
      }' \
  '' \
  "$SE"

# 8 — a track duplicate copies only the first section
probe "8 track duplicate copies one section" \
  src/lib/song/track-lifecycle.ts \
  '      const sections = song.sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar): Bar => {
          const slots = bar.slots[source.id];' \
  '      const sections = song.sections.map((section, sectionIndex) => ({
        ...section,
        bars: section.bars.map((bar): Bar => {
          const slots = sectionIndex === 0 ? bar.slots[source.id] : undefined;' \
  "$T"

# 9 — deleting one track empties every lane
probe "9 track delete wipes the other lanes" \
  src/lib/song/track-lifecycle.ts \
  '      if (!(trackId in bar.slots)) return bar;
      const slots = { ...bar.slots };
      delete slots[trackId];
      return { ...bar, slots };' \
  '      void trackId;
      return { ...bar, slots: {} };' \
  "$T"

# 10 — the last track becomes deletable
probe "10 the last track can be deleted" \
  src/lib/song/track-lifecycle.ts \
  '      if (song.tracks.length <= 1) {
        return { ok: false, error: { code: "last_track_undeletable" } };
      }' \
  '' \
  "$T"

# 11 — a preset outside the core registry slips through
probe "11 a non-core preset is accepted" \
  src/lib/song/track-lifecycle.ts \
  '  if (!isCorePreset(setup.instrumentId, setup.presetId)) return "unknown_preset";' \
  '  void isCorePreset;' \
  "$T"

# 12 — the asked-for tuning is silently replaced with the standard
probe "12 tuning intent falls back to standard silently" \
  src/lib/song/track-lifecycle.ts \
  '    ...(setup.fretboard
      ? {
          fretboard: {
            tuning: [...setup.fretboard.tuning],
            capo: setup.fretboard.capo,
          },
        }
      : {}),' \
  '    ...(setup.fretboard
      ? {
          fretboard: {
            tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
            capo: 0,
          },
        }
      : {}),' \
  "$T"

# 13 — an incompatible setup passes by silently clearing the content
probe "13 incompatible setup clears positions to pass" \
  src/lib/song/track-lifecycle.ts \
  '      return guardCandidate(withTracks(song, tracks), "setup_incompatible");' \
  '      const attempt = guardCandidate(withTracks(song, tracks), "setup_incompatible");
      if (attempt.ok) return attempt;
      return guardCandidate({
        ...song,
        tracks,
        sections: sectionsWithoutTrackKey(song.sections, command.trackId),
      });' \
  "$T"

# 14 — undo stops going anywhere
probe "14 undo does not bring the old song back" \
  src/lib/song/edit-history.ts \
  '  if (!canUndo(history)) return history;
  return { snapshots: history.snapshots, cursor: history.cursor - 1 };' \
  '  if (!canUndo(history)) return history;
  return { snapshots: history.snapshots, cursor: history.cursor };' \
  "$ST"

# 15 — the Workspace grows past its budget
probe "15 the workspace line budget is exceeded" \
  src/components/workspace/Workspace.tsx \
  '"use client";' \
  '"use client";
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p
// p' \
  "$B"

# 16 — a warning starts blocking like an error
probe "16 warnings block like errors" \
  src/lib/song/lifecycle-guard.ts \
  '  if (hasErrors(issues)) return { ok: false, error: { code: failCode } };' \
  '  if (issues.length > 0) return { ok: false, error: { code: failCode } };' \
  "$SE"

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
