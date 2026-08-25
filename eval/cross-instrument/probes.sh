#!/usr/bin/env bash
# Vacuity probes for cross-instrument note entry (2Q-B §17).
#
# Forty-two mutations, each of which puts back a way this checkpoint's
# guarantees could be quietly untrue — a hit that rounds onto the grid, a
# lane that is dropped when its last hit goes, an octave invented for an
# instrument, an enharmonic silently re-spelled, a chord written as metadata,
# a refusal that writes anyway, a gate that closes on the instruments this
# checkpoint opened — and asserts that a named test really goes red.
#
# The mutation is always the *dangerous behaviour*, never a syntax error: a
# probe that only breaks compilation proves nothing about the test.
#
#   ./eval/cross-instrument/probes.sh
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
ENTRY="$V src/lib/song/event-entry.test.ts"
DRUMMODEL="$V src/lib/tab/drum-step-model.test.ts"
PITCHMODEL="$V src/lib/tab/pitched-step-model.test.ts"
NAMES="$V src/lib/music/note-names.test.ts"
PARITY="$V src/lib/song/event-entry-parity.test.ts"
HISTORY="$V src/lib/song/event-entry-history.test.ts"
BOUND="$V src/lib/song/event-entry-boundary.test.ts"
GATE="$V src/lib/workspace/edit-gate.test.ts"
CHORD="$V src/lib/chords/chord-unwritten-lane.test.ts src/lib/chords/chord-command.test.ts"
LIFE="$V src/lib/song/track-lifecycle.test.ts"

echo "--- bir an tek slotu adlandırır (§3) ---"

probe "1 an off-grid tick is rounded onto the grid instead of refused" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '      if (inside % perSlot !== 0) return "off_grid_target";
      return { sectionIndex, barIndex, slotIndex: inside / perSlot, bar, track };' \
  '      return {
        sectionIndex,
        barIndex,
        slotIndex: Math.round(inside / perSlot),
        bar,
        track,
      };'

probe "2 a tick past the last bar lands in the last bar anyway" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  return "bar_not_found";' \
  '  const last = section.bars.length - 1;
  const bar = section.bars[last];
  return bar
    ? { sectionIndex, barIndex: last, slotIndex: 0, bar, track }
    : "bar_not_found";'

probe "3 a negative tick is accepted" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!Number.isInteger(target.ticks) || target.ticks < 0) return "off_grid_target";' \
  '  if (!Number.isInteger(target.ticks)) return "off_grid_target";'

probe "4 a fractional tick is accepted" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!Number.isInteger(target.ticks) || target.ticks < 0) return "off_grid_target";' \
  '  if (target.ticks < 0) return "off_grid_target";'

probe "5 a missing section falls back to the first one" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!section) return "section_not_found";' \
  '  if (!section) return "bar_not_found";'

echo "--- davul vuruşu (§4) ---"

probe "6 the same piece twice on one beat is written as two hits" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (slot.some((existing) => existing.piece === hit.piece)) return refuse("target_occupied");' \
  ''

probe "7 a drum command is accepted on a guitar" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!isDrumInstrument(at.track.instrumentId)) return refuse("track_not_drums");
  if (!DRUM_PIECES.includes(hit.piece)) return refuse("unknown_drum_piece");' \
  '  if (!DRUM_PIECES.includes(hit.piece)) return refuse("unknown_drum_piece");'

probe "8 an unknown drum piece is written" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!DRUM_PIECES.includes(hit.piece)) return refuse("unknown_drum_piece");' \
  ''

probe "9 removing the last hit drops the lane key with it" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  const next = [...lane];
  next[at.slotIndex] = slot.filter((hit) => hit.piece !== piece);
  return finish(withLane(song, at, next));' \
  '  const next = [...lane];
  next[at.slotIndex] = slot.filter((hit) => hit.piece !== piece);
  const dropped = next.every((entry) => Array.isArray(entry) && entry.length === 0);
  if (dropped) {
    const sections = [...song.sections];
    const section = sections[at.sectionIndex]!;
    const bars = [...section.bars];
    const slots = { ...at.bar.slots };
    delete slots[at.track.id];
    bars[at.barIndex] = { ...at.bar, slots };
    sections[at.sectionIndex] = { ...section, bars };
    return finish({ ...song, sections });
  }
  return finish(withLane(song, at, next));'

probe "10 removing a piece that is not there succeeds anyway" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!slot.some((hit) => hit.piece === piece)) return refuse("nothing_to_remove");' \
  ''

probe "11 hits are stored in the order they were tapped" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  return [...hits].sort(
    (left, right) => DRUM_PIECES.indexOf(left.piece) - DRUM_PIECES.indexOf(right.piece),
  );' \
  '  return [...hits];'

probe "12 velocity is dropped on the way in" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '    ...(hit.velocity === undefined ? {} : { velocity: hit.velocity }),' \
  ''

probe "13 articulation is dropped on the way in" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '    ...(hit.articulation === undefined ? {} : { articulation: hit.articulation }),' \
  ''

probe "14 the toggle asks the last render instead of the song" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  const lane = at.bar.slots[at.track.id];
  const slot = Array.isArray(lane) ? lane[at.slotIndex] : undefined;
  return Array.isArray(slot) && (slot as DrumSlot).some((hit) => hit.piece === piece);' \
  '  return false;'

echo "--- perdesiz nota (§6, §7) ---"

probe "15 a pitched command is accepted on a guitar" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!isPitchedTrack(at.track)) return refuse("track_not_pitched");
  if (!PITCH_PATTERN.test(note.pitch)) return refuse("pitch_unreadable");' \
  '  if (!PITCH_PATTERN.test(note.pitch)) return refuse("pitch_unreadable");'

probe "16 an unreadable pitch is written" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!PITCH_PATTERN.test(note.pitch)) return refuse("pitch_unreadable");' \
  ''

probe "17 an occupied moment is overwritten without being asked" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (occupied && options.replace !== true) return refuse("target_occupied");' \
  ''

probe "18 a note longer than the bar is written past its end" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (at.slotIndex + held > lane.length) return refuse("off_grid_target");' \
  ''

probe "19 a held note writes no ties" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  for (let step = 1; step < held; step += 1) next[at.slotIndex + step] = "-";' \
  ''

probe "20 a string and fret are written for a piano" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  const event: NoteEvent = {
    pitch: note.pitch,' \
  '  const event: NoteEvent = {
    position: { string: 0, fret: 0 },
    pitch: note.pitch,'

probe "21 removing an onset leaves its ties orphaned" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  for (let index = at.slotIndex + 1; index < next.length && next[index] === "-"; index += 1) {
    next[index] = null;
  }' \
  ''

probe "22 removing from an empty moment succeeds anyway" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  if (!lane || slot === null || slot === undefined || slot === "-") {
    return refuse("nothing_to_remove");
  }' \
  '  if (!lane) return refuse("nothing_to_remove");'

echo "--- tek kapı: settle (§3.2) ---"

probe "23 a candidate skips the validator chain" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  const settled = settle(candidate);
  return settled.ok
    ? { ok: true, song: settled.song, warnings: settled.warnings }
    : refuse("validation_failed");' \
  '  return { ok: true, song: candidate, warnings: [] };'

probe "24 the lane is laid as a separate write before the command" \
  src/lib/song/event-entry.ts "$ENTRY" \
  '  const ready = withEmptyLaneInBar(song, at.track, song.sections[at.sectionIndex]!.id, at.barIndex);' \
  '  const ready = song;'

echo "--- davul ızgarası modeli (§5.1) ---"

probe "25 an empty kit gets no rows, so the first hit has nowhere to land" \
  src/lib/tab/drum-step-model.ts "$DRUMMODEL" \
  '  for (const piece of CORE_DRUM_PIECES) used.add(piece);' \
  ''

probe "26 a piece the song uses is dropped from the rows" \
  src/lib/tab/drum-step-model.ts "$DRUMMODEL" \
  '        for (const hit of slot as DrumSlot) used.add(hit.piece);' \
  ''

probe "27 rows come back in whatever order they were found" \
  src/lib/tab/drum-step-model.ts "$DRUMMODEL" \
  '  return DRUM_PIECES.filter((piece) => used.has(piece));' \
  '  return [...used];'

probe "28 a cell carries its slot index instead of its tick" \
  src/lib/tab/drum-step-model.ts "$DRUMMODEL" \
  '          ticks: bar.startTicks + slotIndex * perSlot,' \
  '          ticks: slotIndex,'

probe "29 bar numbers restart at one in every section" \
  src/lib/tab/drum-step-model.ts "$DRUMMODEL" \
  '  let barNumber = 0;
  for (const entry of song.sections) {
    if (entry.id === resolvedId) break;
    barNumber += entry.bars.length;
  }' \
  '  const barNumber = 0;'

probe "30 a silent lane and a missing one are reported the same" \
  src/lib/tab/drum-step-model.ts "$DRUMMODEL" \
  '    silentThroughout: (section?.bars ?? []).every(
      (bar) => !Object.prototype.hasOwnProperty.call(bar.slots, trackId),
    ),' \
  '    silentThroughout: (section?.bars ?? []).every((bar) => {
      const lane = bar.slots[trackId];
      return !Array.isArray(lane) || lane.every((slot) => !Array.isArray(slot) || slot.length === 0);
    }),'

echo "--- perdesiz şerit modeli (§7.1) ---"

probe "31 written silence and an unwritten bar become the same state" \
  src/lib/tab/pitched-step-model.ts "$PITCHMODEL" \
  '  if (!written || slot === undefined) return "blank";' \
  '  if (slot === undefined) return "rest";'

probe "32 a tie is reported as an onset" \
  src/lib/tab/pitched-step-model.ts "$PITCHMODEL" \
  '  if (slot === "-") return "tie";' \
  ''

probe "33 only the first pitch of a chord is reported" \
  src/lib/tab/pitched-step-model.ts "$PITCHMODEL" \
  '            ? slot.notes.map((note) => note.pitch)' \
  '            ? slot.notes.slice(0, 1).map((note) => note.pitch)'

probe "34 the sheet opens on an octave chosen here rather than read from the music" \
  src/lib/tab/pitched-step-model.ts "$PITCHMODEL" \
  '  const fromTrack = lastOctave(song, trackId);
  if (fromTrack !== null) return fromTrack;' \
  ''

probe "35 a cell carries its slot index instead of its tick" \
  src/lib/tab/pitched-step-model.ts "$PITCHMODEL" \
  '        ticks: startTicks + slotIndex * perSlot,' \
  '        ticks: slotIndex,'

echo "--- notanın okunur adı (§7.2) ---"

probe "36 an enharmonic is silently re-spelled with sharps" \
  src/lib/music/note-names.ts "$NAMES" \
  '  b: "bemol",' \
  '  b: "diyez",'

probe "37 the accidental is dropped from the spoken name" \
  src/lib/music/note-names.ts "$NAMES" \
  '    spoken: accidental === null ? letter : `${letter} ${ACCIDENTAL_WORDS[accidental]}`,' \
  '    spoken: letter,'

probe "38 something that is not a pitch is described anyway" \
  src/lib/music/note-names.ts "$NAMES" \
  '  const parsed = parsePitch(pitch);
  if (!parsed) return null;' \
  '  const parsed = parsePitch(pitch) ?? { letter: "C", accidental: null, octave: 4 };'

echo "--- akor, geçmiş, parite ve kapı (§8, §11, §12) ---"

probe "39 the chord command refuses a bar the track is not written in" \
  src/lib/chords/chord-command.ts "$CHORD" \
  '    entry !== undefined && (entry.writable || (melodic && entry.slot === undefined));' \
  '    entry !== undefined && entry.writable;'

probe "40 the chord command lays lanes across the whole section" \
  src/lib/chords/chord-command.ts "$CHORD" \
  '  for (const barIndex of new Set(span.map((cursor) => stream[cursor]!.barIndex))) {' \
  '  for (const barIndex of section.bars.map((_, index) => index)) {'

probe "41 the edit gate closes again on everything but fretted tracks" \
  src/lib/workspace/edit-gate.ts "$GATE" \
  '  const canEdit = track !== undefined && !previewOpen && canPersist;' \
  '  const canEdit =
    track !== undefined &&
    track.fretboard !== undefined &&
    !previewOpen &&
    canPersist;'

probe "42 creating a track leaves the reader on the one they were on" \
  src/lib/song/track-lifecycle.ts "$LIFE" \
  '  const made = after.tracks.filter((track) => !had.has(track.id));
  return made.length === 1 ? (made[0]?.id ?? null) : null;' \
  '  void had;
  return null;'

probe "43 a hit written by command serialises differently from one written by hand" \
  src/lib/song/event-entry.ts "$PARITY" \
  '  const written: DrumHit = {
    piece: hit.piece,' \
  '  const written: DrumHit = {
    velocity: 100,
    piece: hit.piece,'

probe "44 a refused command still hands back a song" \
  src/lib/song/event-entry.ts "$HISTORY" \
  'const refuse = (code: EventEntryErrorCode): EventEntryResult => ({ ok: false, code });' \
  'const refuse = (code: EventEntryErrorCode): EventEntryResult =>
  ({ ok: true, song: undefined as never, warnings: [] }) as EventEntryResult &
    { readonly code?: EventEntryErrorCode } &
    { readonly ignored?: typeof code };'

probe "45 the command core reaches for the message table itself" \
  src/lib/song/event-entry.ts "$BOUND" \
  'import type { ValidationIssue } from "@/lib/validators/types";' \
  'import type { ValidationIssue } from "@/lib/validators/types";
import { EVENT_ENTRY_MESSAGES } from "@/lib/song/event-entry-messages";
void EVENT_ENTRY_MESSAGES;'

echo
echo "kırmızı $pass · vacuous $fail · atlanan $skipped"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
