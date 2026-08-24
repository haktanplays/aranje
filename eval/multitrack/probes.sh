#!/usr/bin/env bash
# Vacuity probes for the synchronised multi-instrument view, the writable new
# track and the mobile transport (2Q-A §18).
#
# Twenty-eight mutations, each of which puts back a way this checkpoint's
# guarantees could be quietly untrue — a new track that is silent *and*
# unwritable, a first note that costs two writes, a lane that scrolls on its
# own, a playhead pinned to the edge of a section it is not in, a fold that
# follows the reader into somebody else's project — and asserts that a named
# test really goes red.
#
# The mutation is always the *dangerous behaviour*, never a syntax error: a
# probe that only breaks compilation proves nothing about the test.
#
#   ./eval/multitrack/probes.sh
set -u

pass=0; fail=0; skipped=0

# probe <name> <file> <command> <find1> <repl1> [<find2> <repl2> ...]
probe() {
  local name="$1" file="$2" cmd="$3"; shift 3
  # A leftover backup means another probe run is touching this file. Two runs
  # racing over one source silently restore each other's mutation and can
  # leave a real edit behind, so this refuses rather than guesses.
  if [ -e "$file.probebak" ]; then
    echo "ABORT $name: $file.probebak exists — another probe run is in flight"
    exit 2
  fi
  cp "$file" "$file.probebak"
  python3 - "$file" "$@" <<'PY'
import io,sys
path=sys.argv[1]; pairs=sys.argv[2:]
s=io.open(path,encoding="utf-8").read()
for i in range(0,len(pairs),2):
    f,r=pairs[i],pairs[i+1]
    if f not in s:
        sys.stderr.write("ANCHOR MISSING: "+f[:70]+"\n"); sys.exit(2)
    s=s.replace(f,r,1)
io.open(path,"w",encoding="utf-8").write(s)
PY
  if [ $? -ne 0 ]; then
    echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"
    skipped=$((skipped+1)); return
  fi

  if eval "$cmd" >/dev/null 2>&1; then
    echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
  else
    echo "RED   $name"; pass=$((pass+1))
  fi
  mv "$file.probebak" "$file"
}

V="npx vitest run"
LANES="$V src/lib/song/track-lanes.test.ts src/lib/song/track-lifecycle.test.ts"
CARRY="$V src/lib/multitrack/carry.test.ts"
PARITY="$V src/lib/multitrack/playback-parity.test.ts"
MODEL="$V src/lib/multitrack/model.test.ts"
FOLDS="$V src/lib/multitrack/folds.test.ts"
BOUND="$V src/lib/multitrack/multitrack-boundary.test.ts"
WSBOUND="$V src/lib/workspace/workspace-boundary.test.ts"

echo "--- yeni track yazılabilir (§1, §2) ---"

probe "1 create_track goes back to leaving no key anywhere" \
  src/lib/song/track-lifecycle.ts "$LANES" \
  '      return guardCandidate(
        withEmptyLanes(withTracks(song, [...song.tracks, track]), track),
      );' \
  '      return guardCandidate(withTracks(song, [...song.tracks, track]));'

probe "2 an empty lane is written as rests for a drum kit too" \
  src/lib/song/track-lanes.ts "$LANES" \
  '  return isDrumInstrument(track.instrumentId)
    ? Array.from({ length: count }, (): DrumSlot => [])
    : Array.from({ length: count }, (): MelodicSlot => null);' \
  '  return Array.from({ length: count }, (): MelodicSlot => null);'

probe "3 the lane length is guessed instead of read from the bar" \
  src/lib/song/track-lanes.ts "$LANES" \
  '  const count = slotCount(bar.timeSignature, bar.resolution);' \
  '  const count = 16;'

probe "4 laying a lane overwrites what the track already had there" \
  src/lib/song/track-lanes.ts "$LANES" \
  '  if (isWrittenInBar(bar, track.id)) return bar;' \
  '  if (false) return bar;'

probe "5 laying a lane returns a new bar even when it changed nothing" \
  src/lib/song/track-lanes.ts "$LANES" \
  '  if (isWrittenInBar(bar, track.id)) return bar;' \
  '  if (isWrittenInBar(bar, track.id)) return { ...bar };'

probe "6 the first-note path lays a lane in every bar, not the one" \
  src/lib/song/track-lanes.ts "$LANES" \
  '  const bars = [...section.bars];
  bars[barIndex] = withEmptyLane(bar, track);' \
  '  const bars = section.bars.map((entry) => withEmptyLane(entry, track));'

probe "7 the write path stops laying the lane at all" \
  src/lib/song/edit.ts "$LANES" \
  '  const song = laneReady(input, command);' \
  '  const song = input;'

probe "8 a rest or a tie materialises a lane nobody asked for" \
  src/lib/song/edit.ts "$LANES" \
  '  if (command.kind !== "set_note") return song;' \
  '  if (command.kind === "clear_string") return song;'

# The obvious mutation here — dropping the `isEditableTrack` guard — turns out
# to be inert: a kit has no fretboard, so `resolve` refuses the command anyway
# and the materialised lane dies with the discarded candidate. What is actually
# dangerous is the candidate reaching the reader's song, so that is what this
# probe does.
probe "9 the candidate lane leaks back into the reader's song" \
  src/lib/song/edit.ts "$LANES" \
  '  const song = laneReady(input, command);
  const resolved = resolve(song, command.target);' \
  '  const song = laneReady(input, command);
  Object.assign(input, song);
  const resolved = resolve(song, command.target);'

probe "10 an impossible fret is written, so the refusal never protects the lane" \
  src/lib/song/edit.ts "$LANES" \
  '      if (!Number.isInteger(command.fret) || command.fret < 0 || command.fret > maxFret) {' \
  '      if (!Number.isInteger(command.fret) || command.fret < 0 || command.fret > 999) {'

echo "--- iki sessizlik aynı sessizlik (§12, §11) ---"

probe "11 an empty lane is written as a tie run instead of rests" \
  src/lib/song/track-lanes.ts "$LANES $CARRY" \
  '    : Array.from({ length: count }, (): MelodicSlot => null);' \
  '    : Array.from({ length: count }, (): MelodicSlot => "-");'

probe "12 a bar the track is not written in keeps a tie chain alive" \
  src/lib/tab/timeline.ts "$CARRY" \
  '  if (slots === undefined) {' \
  '  if (false) {'

probe "13 the plan builders start reading a second argument" \
  src/lib/audio/schedule.ts "$PARITY" \
  'export function buildSongPlan(song: Song): SongPlan {' \
  'export function buildSongPlan(song: Song, activeTrackId?: string): SongPlan {
  void activeTrackId;'

probe "14 the audio layer starts importing the view model" \
  src/lib/audio/schedule.ts "$PARITY" \
  'export function barTimeline(song: Song): BarMarker[] {' \
  '// @/lib/multitrack/model
export function barTimeline(song: Song): BarMarker[] {'

echo "--- tek zaman ekseni ve tek playhead (§5, §6, §7) ---"

probe "15 the model draws every section instead of the one asked for" \
  src/lib/multitrack/model.ts "$MODEL" \
  '    const isTarget = section.id === sectionId;' \
  '    const isTarget = true;'

probe "16 every lane is reported active" \
  src/lib/multitrack/model.ts "$MODEL" \
  '      active: track.id === activeTrackId,' \
  '      active: true,'

probe "17 a silent track is dropped from the stack" \
  src/lib/multitrack/model.ts "$MODEL" \
  '  const lanes = song.tracks.map((track): MultiTrackLane => {' \
  '  const lanes = song.tracks.filter((t) => t.id === activeTrackId).map((track): MultiTrackLane => {'

probe "18 the section axis starts at the song's zero, not the section's" \
  src/lib/multitrack/model.ts "$MODEL" \
  '          startTicks: songTicks - startTicks,' \
  '          startTicks: songTicks,'

probe "19 a pitched lane is given a string and a fret" \
  src/lib/multitrack/lane-kind.ts "$MODEL" \
  '  return track.fretboard ? "fretted" : "pitched";' \
  '  return "fretted";'

probe "20 a kit is drawn as a fretted staff" \
  src/lib/multitrack/lane-kind.ts "$MODEL" \
  '  if (isDrumInstrument(track.instrumentId)) return "drums";' \
  '  if (false) return "drums";'

probe "21 the pitch axis rescales per bar instead of per section" \
  src/lib/multitrack/model.ts "$MODEL" \
  '  const span = Math.max(high - low, PITCH_AXIS_MIN_SEMITONES);' \
  '  const span = Math.max(high - low, 0);'

probe "22 a bar's width stops following its slot count" \
  src/lib/multitrack/geometry.ts "$MODEL" \
  '    const width = bar.slotCount * slotWidth;' \
  '    const width = 16 * slotWidth;'

probe "23 the playhead is pinned to the edge of a section it is not in" \
  src/lib/multitrack/geometry.ts "$MODEL" \
  '  if (local < 0 || local > axis.totalTicks) return null;' \
  '  if (local < 0) return 0;
  if (local > axis.totalTicks) return axis.width;'

probe "24 a slot is placed with a width that is not its bar's" \
  src/lib/multitrack/geometry.ts "$MODEL" \
  '  return bar.x + slotIndex * (bar.width / Math.max(1, bar.slotCount));' \
  '  return bar.x + slotIndex * 34;'

echo "--- oturum durumu ve sınırlar (§9, §14) ---"

probe "25 a fold follows the reader into another project" \
  src/lib/multitrack/folds.ts "$FOLDS" \
  '  if (stored.projectId !== projectId) return new Set();' \
  '  if (false) return new Set();'

probe "26 a fold on a deleted track survives" \
  src/lib/multitrack/folds.ts "$FOLDS" \
  '  return new Set([...stored.ids].filter((id) => known.has(id)));' \
  '  return new Set(stored.ids);'

probe "27 tapping a folded lane refuses to open it" \
  src/lib/multitrack/folds.ts "$FOLDS" \
  '  if (ids.has(trackId)) ids.delete(trackId);
  else ids.add(trackId);' \
  '  ids.add(trackId);'

probe "28 a lane gets its own horizontal scroller" \
  src/components/workspace/FrettedMultiLane.tsx "$BOUND" \
  'export function FrettedMultiLane(' \
  'const OWN_SCROLLER = "overflow-x-auto";
export function FrettedMultiLane('

probe "29 the canvas runs its own animation frames" \
  src/components/workspace/MultiTrackCanvas.tsx "$BOUND" \
  '    return runPlayheadLoop({ source: "multi", running, draw });' \
  '    const handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);'

probe "30 the session controller reaches for the song store" \
  src/lib/workspace/use-multitrack-session.ts "$BOUND" \
  'import { buildMultiTrackModel, type MultiTrackModel } from "@/lib/multitrack/model";' \
  'import { loadSong } from "@/lib/song/song-store";
import { buildMultiTrackModel, type MultiTrackModel } from "@/lib/multitrack/model";'

probe "31 the workspace grows again to hold the third surface" \
  src/components/workspace/Workspace.tsx "$WSBOUND" \
  'export function Workspace() {' \
  'export function Workspace() {
  // padding
  // padding
  // padding
  // padding
  // padding
  // padding
  // padding
  // padding
  // padding
  // padding'

echo
echo "kırmızı $pass · yeşil(vacuous) $fail · atlanan $skipped"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
