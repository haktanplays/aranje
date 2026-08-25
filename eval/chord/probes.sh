#!/usr/bin/env bash
# Vacuity probes for the chord builder (2O-B §30).
#
# Each one puts back a way the builder could write the wrong music — a third
# that is a semitone out, a capo that is ignored, a replacement that only
# takes one string — and asserts that a named test really goes red.
#
# The mutations are the *dangerous* behaviour, not a syntax error: a probe that
# only breaks compilation proves nothing about the test.
set -u

pass=0; fail=0
probe() {
  local name="$1" file="$2" find="$3" repl="$4" cmd="$5"
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

FORM="npx vitest run src/lib/chords/chord-formula.test.ts"
FRET="npx vitest run src/lib/chords/fretted-voicing.test.ts"
KB="npx vitest run src/lib/chords/keyboard-voicing.test.ts"
VOI="npx vitest run src/lib/chords/chord-voicing.test.ts"
CMD="npx vitest run src/lib/chords/chord-command.test.ts"
PAR="npx vitest run src/lib/chords/chord-parity.test.ts"
BND="npx vitest run src/lib/chords/chord-boundary.test.ts"
HIST="npx vitest run src/lib/song/history-boundary.test.ts src/lib/workspace/workspace-boundary.test.ts"

# A browser probe rebuilds and restarts, because a mutation that never reaches
# the bundle would be measured against the previous build's code. `CHORD_ONLY`
# runs the group the guard belongs to; the rest of the suite would not make the
# probe truer, only slower.
browser() {
  echo "npm run build && (fuser -k 3100/tcp 2>/dev/null; sleep 1; npx next start -p 3100 & sleep 5) && ONE_VIEWPORT=1 CHORD_ONLY=\"$1\" node eval/chord/verify.mjs"
}

# ------------------------------------------------------------ the vocabulary

probe "1 a major third is a semitone flat" \
  src/lib/chords/chord-formula.ts \
  '    intervals: [0, 4, 7],
    required: [0, 4, 7],
    label: "Majör",' \
  '    intervals: [0, 3, 7],
    required: [0, 3, 7],
    label: "Majör",' \
  "$FORM"

probe "2 a minor third is a semitone sharp" \
  src/lib/chords/chord-formula.ts \
  '    intervals: [0, 3, 7],
    required: [0, 3, 7],
    label: "Minör",' \
  '    intervals: [0, 4, 7],
    required: [0, 4, 7],
    label: "Minör",' \
  "$FORM"

probe "3 a power chord fifth is flat" \
  src/lib/chords/chord-formula.ts \
  '    intervals: [0, 7],
    required: [0, 7],' \
  '    intervals: [0, 6],
    required: [0, 6],' \
  "$FORM"

probe "4 a dominant 7 and a major 7 become the same chord" \
  src/lib/chords/chord-formula.ts \
  '    intervals: [0, 4, 7, 11],
    required: [0, 4, 11],' \
  '    intervals: [0, 4, 7, 10],
    required: [0, 4, 10],' \
  "$FORM"

probe "5 a minor 7 stops requiring its seventh" \
  src/lib/chords/chord-formula.ts \
  '    intervals: [0, 3, 7, 10],
    required: [0, 3, 10],' \
  '    intervals: [0, 3, 7, 10],
    required: [0, 3],' \
  "$FRET"

probe "6 the half-diminished loses its diminished fifth" \
  src/lib/chords/chord-formula.ts \
  '    intervals: [0, 3, 6, 10],
    required: [0, 3, 6, 10],' \
  '    intervals: [0, 3, 6, 10],
    required: [0, 3, 10],' \
  "$FORM"

probe "7 a chord is transposed by the wrong amount" \
  src/lib/chords/chord-formula.ts \
  '  return CHORD_FORMULAS[quality].intervals.map((step) =>
    normalizePitchClass(root + step),
  );' \
  '  return CHORD_FORMULAS[quality].intervals.map((step) =>
    normalizePitchClass(root + step + 1),
  );' \
  "$FORM"

probe "8 pitch classes stop wrapping past B" \
  src/lib/chords/chord-formula.ts \
  '  return ((Math.trunc(value) % 12) + 12) % 12;' \
  '  return Math.trunc(value);' \
  "$FORM"

probe "9 recognition accepts a subset as the whole chord" \
  src/lib/chords/chord-recognition.ts \
  '      if (tones.size !== wanted.size) continue;
      let same = true;
      for (const tone of tones) {
        if (!wanted.has(tone)) {
          same = false;
          break;
        }
      }' \
  '      let same = true;
      for (const tone of wanted) {
        if (!tones.has(tone)) {
          same = false;
          break;
        }
      }' \
  "$FORM"

probe "10 recognition lets the lowest note decide the root" \
  src/lib/chords/chord-recognition.ts \
  '  const matches = matchPitchClasses([...unique]);' \
  '  const matches = matchPitchClasses([...unique]).slice(0, 1);' \
  "$FORM"

probe "11 recognition is changed by how a note is played" \
  src/lib/chords/chord-recognition.ts \
  '  const classes = notes
    .map((note) => pitchClass(note.pitch))' \
  '  const classes = notes
    .filter((note) => note.articulation === undefined)
    .map((note) => pitchClass(note.pitch))' \
  "$FORM"

# ------------------------------------------------------------- the fretboard

probe "12 the capo is ignored when a pitch is worked out" \
  src/lib/chords/fretted-voicing.ts \
  '      const midi = soundingMidi(fretboard, { string: stringIndex, fret });' \
  '      const midi = soundingMidi({ ...fretboard, capo: 0 }, { string: stringIndex, fret });' \
  "$FRET"

probe "13 the tuning is read as standard whatever the track says" \
  src/lib/chords/fretted-voicing.ts \
  '      const midi = soundingMidi(fretboard, { string: stringIndex, fret });' \
  '      const midi = soundingMidi(
        { ...fretboard, tuning: ["E2", "A2", "D3", "G3", "B3", "E4"] },
        { string: stringIndex, fret },
      );' \
  "$FRET"

probe "14 the fret range is clamped instead of refused" \
  src/lib/chords/fretted-voicing.ts \
  '  const maxFret = maxCapoRelativeFret(fretboard.capo);
  const spots: Spot[] = [];' \
  '  const maxFret = Math.min(12, maxCapoRelativeFret(fretboard.capo));
  const spots: Spot[] = [];' \
  "$FRET"

probe "15 the string count is fixed at six" \
  src/lib/chords/fretted-voicing.ts \
  '  const stringCount = fretboard.tuning.length;' \
  '  const stringCount = 6;' \
  "$FRET"

probe "16 a required chord tone may be missing" \
  src/lib/chords/fretted-voicing.ts \
  '        for (const tone of required) {
          if (!shape.soundingClasses.includes(tone)) return;
        }' \
  '        void required;' \
  "$FRET"

probe "17 the stretch limit is dropped" \
  src/lib/chords/fretted-voicing.ts \
  '          (spot.physicalFret >= base && spot.physicalFret <= base + voicingLimits.maxFretSpan);' \
  '          (spot.physicalFret >= base && spot.physicalFret <= base + 8);' \
  "$FRET"

probe "18 a hand may need more fingers than it has" \
  src/lib/chords/fretted-voicing.ts \
  '        if (!handCanHold(current)) return;' \
  '        void handCanHold;' \
  "$FRET"

probe "19 arbitrary inner strings may be muted" \
  src/lib/chords/fretted-voicing.ts \
  '        if (interiorSkips(current) > voicingLimits.maxInteriorSkips) return;' \
  '        void interiorSkips;' \
  "$FRET"

probe "20 a power chord may be any number of notes" \
  src/lib/chords/fretted-voicing.ts \
  '        if (!powerShapeAllowed(shape, request)) return;' \
  '        void powerShapeAllowed;' \
  "$FRET"

probe "21 a power chord may put the fifth in the bass" \
  src/lib/chords/fretted-voicing.ts \
  '  if (shape.bassPitchClass !== normalizePitchClass(request.rootPitchClass)) {
    return false;
  }' \
  '  void shape.bassPitchClass;' \
  "$FRET"

probe "22 the offered shapes stop being distinct" \
  src/lib/chords/fretted-voicing.ts \
  '      if (!distinct) continue;' \
  '      void distinct;' \
  "$FRET"

# 23 — the cap is read in two places, so the mutation has to move the limit
# itself; the test pins the promised number rather than reading it back.
probe "23 the reader is shown the whole search" \
  src/lib/limits.ts \
  '  maxVariations: 4,
  maxPerRegion: 2,' \
  '  maxVariations: 9999,
  maxPerRegion: 2,' \
  "$FRET"

probe "24 the shape order stops being canonical" \
  src/lib/chords/fretted-voicing.ts \
  '  return [...byId.values()].sort(compareFretted);' \
  '  return [...byId.values()];' \
  "$FRET"

# --------------------------------------------------------------- the keyboard

probe "25 an inversion moves the wrong note" \
  src/lib/chords/keyboard-voicing.ts \
  '      stack = [...stack.slice(1), lowest + 12];' \
  '      stack = [...stack.slice(1), lowest + 7];' \
  "$KB"

probe "26 an inversion leaves the register it was asked for" \
  src/lib/chords/keyboard-voicing.ts \
  '      stack = [...stack.slice(1), lowest + 12];
    }
    if (stack.some((midi) => !isWritable(midi))) continue;' \
  '      stack = [...stack.slice(1), lowest + 24];
    }
    if (stack.some((midi) => !isWritable(midi))) continue;' \
  "$KB"

probe "27 a pitch the contract cannot write is offered anyway" \
  src/lib/chords/keyboard-voicing.ts \
  '    if (stack.some((midi) => !isWritable(midi))) continue;' \
  '    void isWritable;' \
  "$KB"

probe "28 a keyboard power chord gets inversions" \
  src/lib/chords/keyboard-voicing.ts \
  '  const inversions = request.quality === "power" ? 1 : base.length;' \
  '  const inversions = base.length;' \
  "$KB"

probe "29 a keyboard chord is written with a fretboard position" \
  src/lib/chords/chord-voicing.ts \
  '    return voicing.stack.midi.map((midi) => dress({ pitch: midiToPitch(midi) }));' \
  '    return voicing.stack.midi.map((midi) =>
      dress({ pitch: midiToPitch(midi), position: { string: 0, fret: 0 } }),
    );' \
  "$VOI"

probe "30 a drum track is offered chords" \
  src/lib/chords/chord-voicing.ts \
  '  if (!isHarmonicTrack(track)) return chordFail("instrument_not_harmonic");' \
  '  void isHarmonicTrack;' \
  "$VOI"

probe "31 an unknown root or quality is guessed at" \
  src/lib/chords/chord-voicing.ts \
  '  if (!isPitchClass(request.rootPitchClass)) return chordFail("invalid_chord_root");' \
  '  void isPitchClass;' \
  "$VOI"

probe "32 'normal' is written into the song as an articulation" \
  src/lib/chords/chord-voicing.ts \
  '    ...(options.articulation === undefined || options.articulation === "normal"
      ? {}
      : { articulation: options.articulation }),' \
  '    ...(options.articulation === undefined
      ? {}
      : { articulation: options.articulation }),' \
  "$VOI"

# ---------------------------------------------------------------- the command

probe "33 an occupied vurus is written over silently" \
  src/lib/chords/chord-command.ts \
  '  if (command.mode === "insert" && occupied) return chordFail("target_occupied");' \
  '  void occupied;' \
  "$CMD"

probe "34 a chord may start inside somebody else'\''s note" \
  src/lib/chords/chord-command.ts \
  '  if (start.slot === "-") return chordFail("target_is_tie_continuation");' \
  '  if (false) return chordFail("target_is_tie_continuation");' \
  "$CMD"

probe "35 a legato bond is cut without asking" \
  src/lib/chords/chord-command.ts \
  '    if (carriesChainArticulation(start)) return chordFail("chord_target_linked");' \
  '    void carriesChainArticulation;' \
  "$CMD"

probe "36 mixed velocities are averaged away" \
  src/lib/chords/chord-command.ts \
  '    if (agreedVelocity(existing) === "mixed") return chordFail("mixed_onset_velocity");' \
  '    void agreedVelocity;' \
  "$CMD"

probe "37 mixed expression is dropped" \
  src/lib/chords/chord-command.ts \
  '    if (agreedArticulation(existing) === "mixed") {
      return chordFail("mixed_onset_expression");
    }' \
  '    void agreedArticulation;' \
  "$CMD"

probe "38 a moment off the grid is rounded to the nearest slot" \
  src/lib/chords/chord-command.ts \
  '  const startIndex = stream.findIndex(
    (entry) => entry.startTicks === command.timeTicks,
  );' \
  '  const startIndex = stream.findIndex(
    (entry) =>
      command.timeTicks >= entry.startTicks &&
      command.timeTicks < entry.startTicks + entry.durationTicks,
  );' \
  "$CMD"

probe "39 a duration that does not fit is shortened to fit" \
  src/lib/chords/chord-command.ts \
  '  if (covered !== command.durationTicks) {
    return chordFail("duration_not_representable");
  }' \
  '  if (covered < command.durationTicks && span.length === 0) {
    return chordFail("duration_not_representable");
  }' \
  "$CMD"

probe "40 a longer chord runs over the next onset" \
  src/lib/chords/chord-command.ts \
  '    if (entry.slot !== null) return chordFail("target_occupied");' \
  '    void entry;' \
  "$CMD"

probe "41 a replaced onset keeps the tail of the note it replaced" \
  src/lib/chords/chord-command.ts \
  '  for (const cursor of replacedSpan) {
    if (span.includes(cursor)) continue;
    const entry = stream[cursor];
    if (entry) writeSlot(next, sectionIndex, command.trackId, entry, null);
  }' \
  '  void replacedSpan;' \
  "$CMD"

probe "42 the command returns a song the validators never saw" \
  src/lib/chords/chord-command.ts \
  '  const settled = settle(next);
  if (!settled.ok) return chordFail("chord_validation_failed");' \
  '  const settled = settle(song);
  if (!settled.ok) return chordFail("chord_validation_failed");' \
  "$CMD"

probe "43 the song handed in is mutated" \
  src/lib/chords/chord-command.ts \
  '  const next = cloneSong(song);' \
  '  const next = song;' \
  "$CMD"

probe "44 a chord that changes nothing is written again" \
  src/lib/chords/chord-command.ts \
  '  if (sameSong(next, song)) return chordFail("chord_no_change");' \
  '  void sameSong;' \
  "$CMD"

# ------------------------------------------------- parity with what came before

probe "45 undo takes back only part of a chord" \
  src/lib/chords/chord-command.ts \
  '    writeSlot(
      next,
      sectionIndex,
      command.trackId,
      entry,
      offset === 0 ? { notes } : "-",
    );' \
  '    writeSlot(
      next,
      sectionIndex,
      command.trackId,
      entry,
      offset === 0 ? { notes: notes.slice(0, 1) } : "-",
    );' \
  "$PAR"

probe "46 a long chord is re-struck instead of held" \
  src/lib/chords/chord-command.ts \
  '      offset === 0 ? { notes } : "-",' \
  '      offset >= 0 ? { notes } : "-",' \
  "$PAR"

probe "47 a component reaches into the search itself" \
  src/components/workspace/ChordBuilderSheet.tsx \
  'import { CHORD_ARTICULATIONS } from "@/lib/chords/chord-command";' \
  'import { CHORD_ARTICULATIONS } from "@/lib/chords/chord-command";
import { frettedCandidates } from "@/lib/chords/fretted-voicing";
void frettedCandidates;' \
  "$BND"

probe "48 the composition root grows past its budget" \
  src/components/workspace/Workspace.tsx \
  'export function Workspace() {' \
  '/* padding line 1 */
/* padding line 2 */
/* padding line 3 */
export function Workspace() {' \
  "$BND"

probe "49 a chord commit stops naming its history action" \
  src/lib/workspace/use-chord-builder.ts \
  '        !commit(outcome.song, {
          kind: "chord",
          mode: target?.occupied ? "chord_replace" : "chord_insert",
        })' \
  '        !commit(outcome.song, JSON.parse('"'"'{"kind":"chord","mode":"chord_insert"}'"'"'))' \
  "$HIST"

# -------------------------------------------------------------- browser probes

probe "50 the audition writes to storage" \
  src/lib/workspace/use-audition.ts \
  '      engine.start(
        auditionSong(song, track, voicing, { velocity, articulation }),
        "chord-audition",
        pause,
      );' \
  '      localStorage.setItem("aranje.project.project-1", localStorage.getItem("aranje.project.project-1") ?? "");
      engine.start(
        auditionSong(song, track, voicing, { velocity, articulation }),
        "chord-audition",
        pause,
      );' \
  "$(browser audition)"

probe "51 a preview voice outlives the sheet" \
  src/lib/workspace/use-audition.ts \
  '  useEffect(() => {
    if (!open) engine.stop();
  }, [engine, open]);' \
  '  useEffect(() => {
    void open;
  }, [engine, open]);' \
  "$(browser audition)"

# 52 — the apply control is closed while the command is refusing. Reachable
# through the linked-onset case, which is this checkpoint's own guard; the
# `canApply` half is defence in depth whose only trigger is storage failing
# mid-session, and that transition could not be produced through the UI.
probe "52 apply is offered while the command is refusing" \
  src/components/workspace/ChordBuilderSheet.tsx \
  'disabled={!builder.canApply || builder.preview === null}' \
  'disabled={false}' \
  "$(browser 'linked and tie')"

probe "53 a stale tab writes the chord anyway" \
  src/lib/song/song-store.ts \
  '    if (!saved.ok) {' \
  '    if (false) {' \
  "$(browser 'stale tab')"

probe "54 a variation is labelled as the recommended one" \
  src/lib/chords/chord-copy.ts \
  '  return bass === "" ? positionLabel(shape) : `${positionLabel(shape)} · ${bass}`;' \
  '  return bass === "" ? positionLabel(shape) : `${positionLabel(shape)} · önerilen`;' \
  "$(browser voicings)"

probe "55 a chord edit reaches another project" \
  src/lib/projects/active-project.ts \
  '      const written = writeRecord(options.storage, active.id, song, options.now());' \
  '      const written = writeRecord(options.storage, "project-2", song, options.now());' \
  "$(browser 'project isolation')"

# Leave the bundle and the artefacts as the committed sources describe them.
npm run build >/dev/null 2>&1
fuser -k 3100/tcp >/dev/null 2>&1
sleep 1
(npx next start -p 3100 >/dev/null 2>&1 &)
sleep 5
node eval/chord/verify.mjs >/dev/null 2>&1
clean=$?

echo
echo "RED: $pass  VACUOUS: $fail"
if [ "$clean" -ne 0 ]; then
  echo "WARNING: the clean re-measurement did not pass — RESULTS.json is not trustworthy"
fi
[ "$fail" -eq 0 ] && [ "$clean" -eq 0 ]
