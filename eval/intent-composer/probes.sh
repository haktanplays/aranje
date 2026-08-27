#!/usr/bin/env bash
# Vacuity probes for the intent composer (2S-A §17).
#
# Every guarantee this checkpoint claims is put back the way it could quietly
# be untrue — a travel time that ignores how much room the note has, a pen that
# roots the chord somewhere the finger is not, a brush that guesses a direction
# instead of refusing, a continuation that moves the original along with the
# copy, a glyph that paints itself back into a card — and a *named* test is
# asserted to go red.
#
# The mutation is always the dangerous behaviour, never a syntax error: a probe
# that only breaks compilation proves nothing about the test.
#
# The browser and real-audio probes live in `browser-probes.sh` and
# `audio-probes.sh`.
#
#   ./eval/intent-composer/probes.sh
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
GLYPH="$V src/lib/tab/glyph-model.test.ts"
TECH="$V src/lib/tab/technique-geometry.test.ts"
STATE="$V src/lib/tab/glyph-state.test.ts"
MARK="$V src/lib/tab/playing-onset.test.ts"
TOOL="$V src/lib/workspace/composer-tool.test.ts"
PEN="$V src/lib/chords/power-chord-pen.test.ts"
BRUSH="$V src/lib/song/legato-brush.test.ts"
CONT="$V src/lib/song/continue-pattern.test.ts"
HIST="$V src/lib/song/intent-history.test.ts"
BOUND="$V src/lib/workspace/intent-boundary.test.ts"
GEOM="$V src/components/workspace/edit-geometry.test.ts"
ART="$V src/lib/song/note-update-articulation.test.ts"
RACE="$V src/lib/copilot/budget-race.test.ts"
WS="$V src/lib/workspace/workspace-boundary.test.ts"
PLAN="$V src/lib/audio/expression-plan.test.ts"
GUIDE="$V src/lib/tab/rhythm-guide.test.ts"

echo "--- the travel fits the note it lands on (§3) ---"

probe "1 the travel ignores how much room the target has" \
  src/lib/audio/legato-chain.ts "$PLAN" \
  '  if (availableSeconds === undefined) return wanted;' \
  '  if (availableSeconds === undefined) return wanted;
  return wanted;'

probe "2 the room is measured from the note before instead of the note after" \
  src/lib/audio/legato-chain.ts "$PLAN" \
  '      const targetRoom = durationSeconds(tempo, onset.timeTicks, onset.durationTicks);' \
  '      const targetRoom = durationSeconds(tempo, 0, onset.timeTicks);'

probe "3 the whole note may be spent travelling" \
  src/lib/audio/expression.ts "$PLAN" \
  '    maxTravelFraction: 0.4,' \
  '    maxTravelFraction: 1,'

probe "4 a note with no room gets the full preset anyway" \
  src/lib/audio/legato-chain.ts "$PLAN" \
  '  return Math.min(wanted, room * expressionPresets.legato.maxTravelFraction);' \
  '  return Math.max(wanted, room * expressionPresets.legato.maxTravelFraction);'

probe "5 the pull-off click outlives the note it belongs to" \
  src/lib/audio/legato-chain.ts "$PLAN" \
  '            durationSeconds: Math.min(
              expressionPresets.legato.pullOff.auxiliary.maxSeconds * timeScale,
              heldAfterArrival,
            ),' \
  '            durationSeconds:
              expressionPresets.legato.pullOff.auxiliary.maxSeconds * timeScale,'

probe "6 negative room counts as room" \
  src/lib/audio/legato-chain.ts "$PLAN" \
  '  const room = Math.max(0, availableSeconds);' \
  '  const room = availableSeconds;'

echo "--- a fret number is a number on a line (§4) ---"

probe "7 the gap is a constant again, so one digit looks boxed" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  const width = text.length * advance;
  return Math.max(MIN_MASK_PX, width + MASK_BLEED_PX * 2);' \
  '  return MIN_MASK_PX + MASK_BLEED_PX * 2 + advance;'

probe "8 the gap forgets the second digit" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  const width = text.length * advance;' \
  '  const width = advance;'

probe "9 the mask leaves no bleed, so the line touches the digit" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  'export const MASK_BLEED_PX = 2;' \
  'export const MASK_BLEED_PX = 0;'

probe "10 an open string reads as the digit zero" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  if (fret === 0) return "Boş tel";' \
  '  if (fret === 0) return "0. perde";'

probe "11 an unplayable note is announced as a question mark" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  if (fret === null) return "Bu nota bu akortta çalınamıyor";' \
  '  if (fret === null) return "?";'

probe "12 the label says the identifier instead of the movement" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  const move = kind === "hammer_on" ? "çekiç" : "koparma";' \
  '  const move = kind;'

probe "13 selection is carried by colour alone" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  selected: "underline",' \
  '  selected: "none",'

probe "14 a refused operation looks exactly like a written one" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  rejected: "struck",' \
  '  rejected: "none",'

probe "15 a ghost preview looks exactly like a written note" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  ghost: "dotted",' \
  '  ghost: "none",'

probe "16 a tie continuation is drawn as a new attack" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '  tie: "tie",' \
  '  tie: "none",'

probe "17 the digit width silently includes the mask" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '    textWidth: text.length * advance,' \
  '    textWidth: maskWidthFor(text, advance),'

probe "18 the shape cue is claimed even when there is no shape" \
  src/lib/tab/glyph-model.ts "$GLYPH" \
  '    hasShapeCue: marker !== "none",' \
  '    hasShapeCue: true,'

echo "--- the technique grammar draws what the music says (TNG §4-§8) ---"

probe "19 the arc direction is read off the fret rather than the pitch" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '  const from = pitchToMidi(previous.pitch);
  const to = pitchToMidi(span.pitch);
  if (from === null || to === null) return false;
  return kind === "hammer_on" ? to > from : to < from;' \
  '  const from = previous.fret ?? 0;
  const to = span.fret ?? 0;
  return kind === "hammer_on" ? to > from : to < from;'

probe "20 a slur is drawn even when the note moves the other way" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '      movesAsWritten(previous, span, span.articulation);' \
  '      true;'

probe "21 a run of slurs becomes one arc per transition again" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '      if (run.length === 0) run = [previous];
      run.push(span);' \
  '      runs.push([previous, span]);'

probe "22 the arc stops exactly on the first and last number" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '        centreOf(first.startSlot, layout) - ARC_OVERHANG_PX,' \
  '        centreOf(first.startSlot, layout),'

probe "23 a run keeps going across a rest" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '  previous.endSlot + 1 === span.startSlot;' \
  '  previous.startSlot < span.startSlot;'

probe "24 an arc crosses the bar line" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '    .filter((span) => span.stringIndex === stringIndex && !span.openStart)' \
  '    .filter((span) => span.stringIndex === stringIndex)'

probe "25 a silent bar still draws its marks" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '  if (bar.silent) return EMPTY;' \
  '  if (false) return EMPTY;'

probe "26 the mark says H for both kinds of slur" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '          text: (kind === "hammer_on" ? "H" : "P") as "H" | "P",' \
  '          text: "H" as "H" | "P",'

probe "27 the H and the P drift off the transition centres" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '          (centreOf(from.startSlot, layout) + centreOf(span.startSlot, layout)) /
          2;' \
  '          centreOf(span.startSlot, layout);'

probe "27a the owner slot forgets its neighbours and takes the whole bar" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '      left = Math.max(left, (centreOf(other.startSlot, layout) + centre) / 2);' \
  '      left = Math.max(left, 0);'

probe "27b a mark may sit inside the neighbouring number" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '  const inset = { left: left + SLOT_INSET_PX, right: right - SLOT_INSET_PX };' \
  '  const inset = { left, right };'

probe "27c the lane clears the string line but not the numerals" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '    bottom: y - Math.max(LANE_CLEAR_PX, DIGIT_HALF_PX + 1),' \
  '    bottom: y - LANE_CLEAR_PX,'

probe "27d a digit is measured as one slot wide whatever it says" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '  const half = maskWidthFor(glyphText(span.fret)) / 2;' \
  '  const half = layout.slotWidth / 2;'

probe "27e the bend arrow grows with the amount it is bending" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '    const run = Math.max(0, Math.min(BEND_RUN_PX, slot.right - startX));' \
  '    const run = Math.max(
      0,
      Math.min(BEND_RUN_PX * (amount === "1" ? 2 : 1), slot.right - startX),
    );'

probe "27f a bend with no amount in the contract still writes a half step" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '  if (articulation === "bend_half") return "½";
  if (articulation === "bend_full") return "1";
  return null;' \
  '  if (articulation === "bend_full") return "1";
  return "½";'

probe "27g a slide moves the digits instead of drawing between them" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '        left: digitBounds(previous, layout).right,
        right: digitBounds(span, layout).left,' \
  '        left: centreOf(previous.startSlot, layout),
        right: centreOf(span.startSlot, layout),'

probe "27h a slide leans the same way whatever the music does" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '      const rising = to > from;' \
  '      const rising = true;'

probe "27i vibrato ignores how long the note is held" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '        VIBRATO_PER_SLOT_PX * (span.endSlot - span.startSlot);' \
  '        VIBRATO_PER_SLOT_PX * 0;'

probe "27j vibrato reaches into the next number" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '        ? Math.min(slot.right, digitBounds(next, layout).left - 2)
        : slot.right;' \
  '        ? bar.slotCount * layout.slotWidth
        : slot.right;'

probe "27k palm mute writes PM once per note again" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '      run.push(span);
    } else {
      if (run.length > 0) runs.push(run);
      run = [span];
    }' \
  '      runs.push(run);
      run = [span];
    } else {
      if (run.length > 0) runs.push(run);
      run = [span];
    }'

probe "27l the palm mute rail runs into the first unmuted note" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '        rail: { left: round(railLeft), right: round(end.right) },' \
  '        rail: { left: round(railLeft), right: round(end.right + 40) },'

probe "27m a technique the contract cannot express is faked from a tie" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '    if (span.articulation !== "vibrato") return;' \
  '    if (span.articulation !== "vibrato" && span.articulation !== "sustain") return;'

probe "27n a note claims a mark that was never drawn for it" \
  src/lib/tab/technique-geometry.ts "$TECH" \
  '  for (const mark of slides) annotated.add(noteKey(mark.stringIndex, mark.slot));' \
  '  for (const span of bar.spans) annotated.add(noteKey(span.stringIndex, span.startSlot));'

probe "27o the bar block draws the character mark on top of the geometry" \
  src/components/workspace/FrettedBarBlock.tsx "$BOUND $TECH" \
  '                  {span.articulation &&
                  !techniques.annotated.has(
                    techniqueNoteKey(span.stringIndex, span.startSlot),
                  ) ? (' \
  '                  {span.articulation ? ('

echo "--- a drawn slur says it once (K-59 §2) ---"

probe "27p the underline comes back under a drawn arc" \
  src/lib/tab/glyph-state.ts "$STATE" \
  '  if (slurred && !request.underArc) return "legato";' \
  '  if (slurred) return "legato";'

probe "27q the underline is dropped even where no arc was drawn" \
  src/lib/tab/glyph-state.ts "$STATE" \
  '  if (slurred && !request.underArc) return "legato";' \
  '  if (false) return "legato";'

probe "27r the rule reaches every annotated note, not only the slurred ones" \
  src/lib/tab/glyph-state.ts "$STATE" \
  '  for (const phrase of primitives.legato) {
    for (const slot of phrase.slots) {
      notes.add(techniqueNoteKey(phrase.stringIndex, slot));
    }
  }' \
  '  for (const key of primitives.annotated) notes.add(key);'

probe "27s the selection stops outranking the other states" \
  src/lib/tab/glyph-state.ts "$STATE" \
  '  if (request.selected) return "selected";' \
  '  if (false) return "selected";'

echo "--- the playhead marks the onset it is on (§4) ---"

probe "28 every glyph on the surface is marked, not the one that sounds" \
  src/lib/tab/playing-onset.ts "$MARK" \
  '      `[data-bar-key="${quote(onset.barKey)}"] ` +
      `[data-glyph-slot="${onset.slotIndex}"]`;' \
  '      `[data-glyph-slot]`;'

probe "29 the previous mark is never taken off" \
  src/lib/tab/playing-onset.ts "$MARK" \
  '  for (const marked of root.querySelectorAll(`[${PLAYING_ATTRIBUTE}]`)) {
    marked.removeAttribute(PLAYING_ATTRIBUTE);
  }' \
  '  void root;'

probe "30 the same onset is re-marked on every frame" \
  src/lib/tab/playing-onset.ts "$MARK" \
  '  if (key === previous) return previous;' \
  '  if (false) return previous;'

echo "--- one tool, held on purpose (§6) ---"

probe "31 choosing the held tool again keeps holding it" \
  src/lib/workspace/composer-tool.ts "$TOOL" \
  '  return sameTool(current, next) ? NO_TOOL : next;' \
  '  return next;'

probe "32 two power chords of different sizes count as the same tool" \
  src/lib/workspace/composer-tool.ts "$TOOL" \
  '    return a.voices === b.voices && a.fret === b.fret;' \
  '    return true;'

probe "33 changing section keeps the tool in the hand" \
  src/lib/workspace/composer-tool.ts "$TOOL" \
  '    case "section_changed":' \
  '    case "section_changed":
      return { kind: "power_chord", voices: 2, fret: 0 };
    case "never_happens":'

probe "34 two different connections count as the same tool" \
  src/lib/workspace/composer-tool.ts "$TOOL" \
  '    return a.connection === b.connection;' \
  '    return true;'

echo "--- the pen roots the chord where the finger is (§7) ---"

probe "35 a shape with a lower note under the finger is offered" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '    return shape.strings.every(
      (entry, index) =>
        entry.kind === "muted" || index >= stringIndex || entry.midi > spot.midi,
    );' \
  '    return true;'

probe "36 the touched fret is not required to be in the shape" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '    if (!spot || spot.kind !== "played" || spot.fret !== fret) return false;' \
  '    if (!spot || spot.kind !== "played") return false;'

probe "37 three voices are written without the octave" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '    withOctave: voices === 3,' \
  '    withOctave: false,'

probe "38 a fretless harmonic track gets an invented fret shape" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '  if (!track.fretboard) return chordFail("power_chord_needs_fretboard");' \
  '  if (!track.fretboard) return chordFail("chord_no_change");'

probe "39 a drum track is written to like a guitar" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '  if (!isHarmonicTrack(track)) return chordFail("instrument_not_harmonic");' \
  '  if (false) return chordFail("instrument_not_harmonic");'

probe "40 the pen invents its own velocity instead of the engine's" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '    velocity: request.velocity ?? DEFAULT_VELOCITY,' \
  '    velocity: request.velocity ?? 64,'

probe "41 the root is reported as the top note of the shape" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '  return { ...written, voicing, rootPitch: voicing.bassPitch };' \
  '  return { ...written, voicing, rootPitch: voicing.pitches[voicing.pitches.length - 1]! };'

probe "42 an unreachable root is refused as an unrelated error" \
  src/lib/chords/power-chord-pen.ts "$PEN" \
  '  if (!voicing) return chordFail("power_chord_root_unreachable");' \
  '  if (!voicing) return chordFail("chord_no_change");'

echo "--- the brush joins what the gesture reached (§8) ---"

probe "43 two notes of the same pitch are joined anyway" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '    if (onset.midi === previous.midi) return refuse("same_pitch");' \
  '    if (false) return refuse("same_pitch");'

probe "44 an explicit hammer-on silently becomes a pull-off" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '    if (request.choice === "hammer_on" && !rising) return refuse("wrong_direction");
    if (request.choice === "pull_off" && rising) return refuse("wrong_direction");' \
  '    void rising;'

probe "45 auto reads the direction off the fret instead of the pitch" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '    const rising = onset.midi > previous.midi;' \
  '    const rising = onset.fret > previous.fret;'

probe "46 a tie inside the run is brushed over" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '        return refuse("tie_inside_run");' \
  '        continue;'

probe "47 a rest inside the run is brushed over" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '        return refuse("rest_inside_run");' \
  '        continue;'

probe "48 an existing slur is overwritten without being asked" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '      request.overrideExisting !== true
    ) {
      return refuse("already_linked");' \
  '      false
    ) {
      return refuse("already_linked");'

probe "49 a single note counts as a gesture" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '  if (onsets.length < 2) return refuse("needs_two_notes");' \
  '  if (onsets.length < 1) return refuse("needs_two_notes");'

probe "50 the run may wander across strings" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '  if (onsets.some((onset) => onset.stringIndex !== string)) {
    return refuse("not_one_string");
  }' \
  '  void string;'

probe "51 a chord in the run is treated as its first note" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '    if (notes.length !== 1) return refuse("chord_in_run");' \
  '    if (notes.length < 1) return refuse("chord_in_run");'

probe "52 the gesture is read one way round only" \
  src/lib/song/legato-brush.ts "$BRUSH" \
  '  const from = Math.min(request.fromTicks, request.toTicks);
  const to = Math.max(request.fromTicks, request.toTicks);' \
  '  const from = request.fromTicks;
  const to = request.toTicks;'

echo "--- the continuation continues (§9) ---"

probe "53 the move is applied to the original as well as the copy" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '    const copySelection = {
      ...selection,
      startTicks: selection.startTicks + width,
      endTicks: selection.endTicks + width,
    };' \
  '    const copySelection = copied.selection;'

probe "54 each copy repeats the first step instead of continuing" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '    selection = copySelection;' \
  '    selection = selection;'

probe "55 running out of section trims in silence" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '      if (request.onOverrun === "fit" && isOverrun(copied)) {' \
  '      if (isOverrun(copied)) {'

probe "56 a count of nothing quietly does nothing" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '  if (!Number.isFinite(repeats) || repeats < 1) {' \
  '  if (false) {'

probe "57 a move of zero takes a different path from an exact repeat" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '    if (mode.stringDelta === 0 && mode.fretDelta === 0) return unchanged;' \
  '    if (false) return unchanged;'

probe "58 the shape move is done by transposing pitches instead" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '      kind: "translate_fret_shape",
      stringDelta: mode.stringDelta,
      fretDelta: mode.fretDelta,' \
  '      kind: "transpose_pitch",
      semitones: mode.fretDelta,'

probe "59 the section end is not counted as running out of room" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '    result.error.code === "section_overflow"' \
  '    false'

probe "60 more cards are drawn than the reader can compare" \
  src/lib/song/continue-pattern.ts "$CONT" \
  'export const MAX_PREVIEW_CARDS = 3;' \
  'export const MAX_PREVIEW_CARDS = 12;'

probe "61 an option is recommended over the others" \
  src/lib/song/continue-pattern.ts "$CONT" \
  '  if (mode.kind === "repeat") return "Aynen tekrar et";' \
  '  if (mode.kind === "repeat") return "Aynen tekrar et (önerilen)";'

echo "--- one gesture is one step, and one owner owns it (§12, §13) ---"

probe "62 replacing a beat and inserting one say the same thing" \
  src/lib/song/history-labels.ts "$HIST" \
  '      return action.mode === "replace"
        ? "Vuruşu power chord ile değiştirme"
        : "Power chord ekleme";' \
  '      return "Power chord ekleme";'

probe "63 undo names the brush by its identifier" \
  src/lib/song/history-labels.ts "$HIST" \
  '      return "Notaları bağlama";' \
  '      return "legato_brush";'

probe "64 the continuation and the brush share a name" \
  src/lib/song/history-labels.ts "$HIST" \
  '      return "Deseni devam ettirme";' \
  '      return "Notaları bağlama";'

probe "65 the composition root grows past its budget" \
  src/components/workspace/Workspace.tsx "$BOUND $WS" \
  'export function Workspace(' \
  '/*
 * A block of comment lines standing in for real growth, so the budget test is
 * measured against a file that got longer rather than against a mutation it
 * could not see.
 */
/* 1 */
/* 2 */
/* 3 */
/* 4 */
/* 5 */
/* 6 */
/* 7 */
/* 8 */
/* 9 */
/* 10 */
/* 11 */
/* 12 */
export function Workspace('

probe "66 a view starts computing the command itself" \
  src/components/workspace/ComposerSheet.tsx "$BOUND" \
  'export function ComposerSheet(' \
  'function planBrush() {
  return null;
}
export function ComposerSheet('

probe "67 a drawing component reaches for the engine" \
  src/components/workspace/FretGlyph.tsx "$BOUND" \
  'import type { Articulation } from "@/lib/song/schema";' \
  'import type { Articulation } from "@/lib/song/schema";
import { expressionPresets } from "@/lib/audio/expression";
void expressionPresets;'

probe "68 a pure core imports React" \
  src/lib/tab/glyph-model.ts "$BOUND" \
  'import type { Articulation } from "@/lib/song/schema";' \
  'import { useMemo } from "react";
void useMemo;
import type { Articulation } from "@/lib/song/schema";'

probe "69 a sheet reaches into the history module" \
  src/components/workspace/ContinuePatternSheet.tsx "$BOUND" \
  'import { Sheet, SheetButton } from "@/components/workspace/Sheet";' \
  'import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { recordEdit } from "@/lib/song/edit-history";
void recordEdit;'

probe "70 the two notation surfaces stop sharing the bar block" \
  src/components/workspace/FrettedBarBlock.tsx "$BOUND" \
  'import { FretGlyph } from "@/components/workspace/FretGlyph";' \
  'const FretGlyph = (_props: unknown) => null;'

echo "--- the rhythm guide still reads (§4) ---"

probe "71 a 1/32 group is beamed as a 1/16 one" \
  src/lib/tab/rhythm-guide.ts "$GUIDE" \
  '  const value = group.levels === 1 ? "1/8" : group.levels === 2 ? "1/16" : "1/32";' \
  '  const value = group.levels === 1 ? "1/8" : "1/16";'

probe "72 a group takes the deepest level rather than the shallowest" \
  src/lib/tab/rhythm-guide.ts "$GUIDE" \
  '      const levels = Math.min(' \
  '      const levels = Math.max('

echo "--- the focused edit layout's geometry (§18) ---"

probe "73 an edit band shorter than a finger" \
  src/components/workspace/geometry.ts "$GEOM" \
  'export const EDIT_STRING_ROW_HEIGHT = MIN_TOUCH_TARGET_PX;' \
  'export const EDIT_STRING_ROW_HEIGHT = 26;'

probe "74 the doors go back to hiding while a run is selected" \
  src/components/workspace/ComposerArea.tsx "$BOUND" \
  '      <ComposerDoorRow tool={tool} onOpen={setDoor} onRelease={composer.release} />' \
  '      {selection === null ? (
        <ComposerDoorRow tool={tool} onOpen={setDoor} onRelease={composer.release} />
      ) : null}'

echo "--- a fret change keeps the music (kapanış §2) ---"

probe "75 a pitch update drops the articulation again" \
  src/lib/song/edit.ts "$ART" \
  '          : previous?.articulation;' \
  '          : undefined;'

probe "76 an invalid link is cleared quietly instead of refused" \
  src/lib/song/edit.ts "$ART" \
  '      if (brokeALink(song, settled.warnings, target.trackId)) {' \
  '      if (false) {'

probe "77 keep and clear stop being different words" \
  src/lib/song/edit.ts "$ART" \
  '      const patch: ArticulationPatch = command.articulation ?? { kind: "keep" };' \
  '      const patch: ArticulationPatch = command.articulation ?? { kind: "clear" };'

probe "78 velocity goes back to being rebuilt from nothing" \
  src/lib/song/edit.ts "$ART" \
  '      const velocity = command.velocity ?? previous?.velocity;' \
  '      const velocity = command.velocity;'

echo "--- one budget, one provider call (kapanış §3) ---"

probe "79 the check and the write stop being one atomic step" \
  src/lib/budget/memory-kv.ts "$RACE" \
  '    transact<T>(keys: readonly string[], body: KvTransaction<T>): Promise<T> {
      const next = queue.then(
        () => run(keys, body),
        () => run(keys, body),
      );
      // Keep the chain alive even when a caller lets a rejection through.
      queue = next.catch(() => undefined);
      return next;
    },' \
  '    async transact<T>(keys: readonly string[], body: KvTransaction<T>): Promise<T> {
      if (!available) throw new KvUnavailableError();
      transactions += 1;
      const current = new Map<string, string | null>();
      for (const key of keys) current.set(key, live(key));
      await Promise.resolve();
      const { writes, result } = body(current);
      for (const write of writes) {
        if ("delete" in write) {
          store.delete(write.key);
          continue;
        }
        store.set(write.key, {
          value: write.value,
          expiresAtMs:
            write.ttlSeconds === undefined ? null : clock.now() + write.ttlSeconds * 1000,
        });
      }
      return result;
    },'

probe "80 the budget check and the reserve stop sharing one critical section" \
  src/lib/budget/reservation.ts "$RACE" \
  '  return kv.transact(
    [dayKey, monthKey, subjectQuotaKey, subjectLockKey, recordKey],' \
  '  return kv.transact(
    [recordKey],'

echo
echo "$pass red, $fail vacuous, $skipped skipped"
exit $(( fail > 0 ? 1 : 0 ))
