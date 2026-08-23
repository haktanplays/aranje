#!/usr/bin/env bash
# Vacuity probes for 2N-A (spec 13.20 §10).
#
# Each one puts back a way the edit core could quietly go wrong — the silent
# chain expansion this checkpoint removed, a beam drawn over silence, a bar
# rounded to the nearest slot instead of refused — and asserts that a named
# test really goes red. A protection nothing notices the loss of is not a
# protection; it is a comment.
#
# The mutations are the *old* behaviour wherever there was one, so a green
# probe would mean the regression could come back unnoticed.
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

ON="npx vitest run src/lib/song/onset-selection.test.ts"
SUM="npx vitest run src/lib/song/selection-summary.test.ts"
CH="npx vitest run src/lib/song/chain-preflight.test.ts"
CM="npx vitest run src/lib/song/chain-messages.test.ts"
TR="npx vitest run src/lib/song/transform.test.ts"
NAV="npx vitest run src/lib/workspace/section-navigation.test.ts"
RL="npx vitest run src/lib/music/rhythm-language.test.ts"
GE="npx vitest run src/lib/music/grid-equivalence.test.ts"
TC="npx vitest run src/lib/song/timing-change.test.ts"
RG="npx vitest run src/lib/tab/rhythm-guide.test.ts"
B="npx vitest run src/lib/workspace/workspace-boundary.test.ts"

# ---------------------------------------------------------------- §1 selection

# 1 — the press grows past the onset group again, which is the defect §0 measured
probe "1 a press reaches past the onset group" \
  src/lib/song/onset-selection.ts \
  '  const last = stream[block.startIndex + block.length - 1];' \
  '  const last = stream[stream.length - 1];' \
  "$ON"

# 2 — pressing the middle of a held note starts the band at the finger
probe "2 a tie press starts at the finger, not at the strike" \
  src/lib/song/onset-selection.ts \
  '      startTicks: first.startTicks,
      endTicks: last.startTicks + last.durationTicks,' \
  '      startTicks: entry.startTicks,
      endTicks: last.startTicks + last.durationTicks,' \
  "$ON"

# 3 — the press stops saying it landed on a tie
probe "3 a tie press is not reported as one" \
  src/lib/song/onset-selection.ts \
  '    fromTie: entry.startTicks !== first.startTicks,' \
  '    fromTie: false,' \
  "$ON"

# 4 — a power chord is described as an ordinary chord
probe "4 a power chord loses its name" \
  src/lib/song/selection-summary.ts \
  '    if (onsetCount === 1 && notes.length > 1) {' \
  '    if (false && onsetCount === 1 && notes.length > 1) {' \
  "$SUM"

# 5 — the held note stops explaining why the band is wide
probe "5 a held note is not called held" \
  src/lib/song/selection-summary.ts \
  '      held = true;' \
  '      held = false;' \
  "$SUM"

# ---------------------------------------------------------------- §2 preflight

# 6 — legato bonds stop counting as connections at all
probe "6 legato is no longer a chain" \
  src/lib/song/chain-preflight.ts \
  'export const CHAINING_ARTICULATIONS: ReadonlySet<Articulation> = new Set([
  "slide",
  "hammer_on",
  "pull_off",
]);' \
  'export const CHAINING_ARTICULATIONS: ReadonlySet<Articulation> = new Set([]);' \
  "$CH"

# 7 — two kinds of boundary are reported as one
probe "7 both kinds collapse into one code" \
  src/lib/song/chain-preflight.ts \
  '  if (kinds.size > 1) return "crosses_multiple_boundaries";' \
  '' \
  "$CH"

# 8 — a chain leaving the section is answered instead of failing closed
probe "8 a cross-section chain is answered anyway" \
  src/lib/song/chain-preflight.ts \
  '  if (boundaries.some((boundary) => boundary.crossesSection)) {
    return "crosses_section_boundary";
  }' \
  '' \
  "$CH"

# 9 — "with the chain" stops widening, so preview and commit can disagree
probe "9 include_chain stops widening the range" \
  src/lib/song/chain-preflight.ts \
  '  for (let guard = 0; guard <= stream.length; guard += 1) {' \
  '  for (let guard = 0; guard < 0; guard += 1) {' \
  "$CH"

# 10 — detaching writes the word "normal" instead of removing the field
probe "10 detach writes a persistent normal articulation" \
  src/lib/song/transform.ts \
  '                const bare: NoteEvent = { pitch: note.pitch };' \
  '                const bare: NoteEvent = { pitch: note.pitch, articulation: "normal" };' \
  "$CH"

# 11 — an orphaned tie is left as a "-" with nothing in front of it
probe "11 an orphaned tie survives as a dash" \
  src/lib/song/chain-preflight.ts \
  '    if (boundary.side === "end" && boundary.outside) {' \
  '    if (false && boundary.side === "end" && boundary.outside) {' \
  "$CH"

# ---------------------------------------------------------------- §2 the gate

# 12 — the core runs without a decision and silently expands, as it used to
probe "12 the core expands silently without a policy" \
  src/lib/song/transform.ts \
  '  if (policy === undefined) {
    return fail(
      "chain_policy_required",
      "Bu seçim bir bağlantıyı kesiyor; nasıl davranılacağı seçilmeden uygulanmaz.",
    );
  }' \
  '  if (policy === undefined) {
    return { ok: true, selection: impact.expanded, impact, detach: [] };
  }' \
  "$TR"

# 13 — a range beginning inside a held note is detached anyway
probe "13 a selection starting inside a tie is detached" \
  src/lib/song/transform.ts \
  '  if (impact.startsInsideTie) {
    return fail(
      "selection_starts_inside_tie",
      "Seçim uzayan bir sesin ortasından başlıyor; ya sesin tamamı alınır ya da hiçbiri.",
    );
  }' \
  '' \
  "$TR"

# 14 — the include-chain sentence stops coming from the command's own verb
probe "14 the include explanation goes generic again" \
  src/lib/song/chain-messages.ts \
  '  return `${INCLUDE_OUTCOMES[kind]}: ${scopeText}.`;' \
  '  void kind;
  return `Bağlantının tamamı birlikte hareket eder: ${scopeText}.`;' \
  "$CM"

# --------------------------------------------------------------- §3 navigation

# 15 — choosing a section does not take over from the transport
probe "15 choosing a section is overridden by playback" \
  src/lib/workspace/section-navigation.ts \
  '      return settle({ viewedSectionId: event.sectionId, followsPlayback: false });' \
  '      return settle({ viewedSectionId: event.sectionId, followsPlayback: true });' \
  "$NAV"

# 16 — the playhead is drawn over music the transport is nowhere near
probe "16 the playhead is drawn in the wrong section" \
  src/lib/workspace/section-navigation.ts \
  '  if (playingBarKey === null) return false;
  return sectionOf(playingBarKey) === view.viewedSectionId;' \
  '  return playingBarKey !== null;' \
  "$NAV"

# ------------------------------------------------------------ §4-§5 the words

# 17 — steps are announced as beats: "16 vuruş"
probe "17 steps are called beats" \
  src/lib/music/rhythm-language.ts \
  '  const count = felt
    ? Math.round(steps / perBeat)
    : timeSignature[0];' \
  '  const count = steps;' \
  "$RL"

# 18 — 7/8 is given a main-beat count nothing in the contract supports
probe "18 7/8 is given an invented main beat" \
  src/lib/music/rhythm-language.ts \
  '  const unit = felt
    ? "ana vuruş"
    : (NOTE_VALUE_NAMES[timeSignature[1]] ?? `1/${timeSignature[1]}`);' \
  '  const unit = "ana vuruş";' \
  "$RL"

# 19 — a meter and grid that cannot be written together are accepted
probe "19 an unwritable meter and grid pair passes" \
  src/lib/music/timing.ts \
  '  if (resolution % denominator !== 0) return false;' \
  '' \
  "$GE"

# ------------------------------------------------------------- §6 the command

# 20 — a rhythm that does not land on the target grid is rounded to it
probe "20 the new grid rounds instead of refusing" \
  src/lib/song/bar-regrid.ts \
  '    if (run.startTicks % toStep !== 0) return { ok: false, reason: "grid_incompatible" };
    if (run.durationTicks % toStep !== 0) {
      return { ok: false, reason: "grid_incompatible" };
    }

    const at = run.startTicks / toStep;
    const span = run.durationTicks / toStep;' \
  '    const at = Math.round(run.startTicks / toStep);
    const span = Math.max(1, Math.round(run.durationTicks / toStep));' \
  "$TC"

# 21 — content that overruns a shortened bar is cut off rather than refused
probe "21 a shortened bar truncates its content" \
  src/lib/song/bar-regrid.ts \
  '    if (at + span > toSlotCount) return { ok: false, reason: "exceeds_measure" };' \
  '    if (at >= toSlotCount) continue;' \
  "$TC"

# 22 — a relation across the bar line is broken without saying so
probe "22 a chain across the bar line is split silently" \
  src/lib/song/timing-change.ts \
  '      if (
        reachesBackOver(section.bars[index + 1], trackId) &&
        soundedToTheLine &&
        !endsSounding(result.slots)
      ) {
        return fail(
          "timing_change_splits_chain",
          "Bu değişiklik ölçü çizgisini aşan bir bağlantıyı koparıyor.",
        );
      }' \
  '      void soundedToTheLine;' \
  "$TC"

# 23 — a track that was never written in the bar gains a fake empty lane
probe "23 an unwritten track gains an empty slot array" \
  src/lib/song/timing-change.ts \
  '    const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};' \
  '    const slots: Record<string, MelodicSlot[] | DrumSlot[]> = Object.fromEntries(
      song.tracks.map((track) => [track.id, [] as MelodicSlot[]]),
    );' \
  "$TC"

# ------------------------------------------------------------------ §7 the beam

# 24 — a tie becomes a group member of its own
probe "24 a tie counts as a new onset" \
  src/lib/tab/rhythm-guide.ts \
  '    if (state !== "onset") return;' \
  '    if (state !== "onset" && state !== "sustain") return;' \
  "$RG"

# 25 — a beam reaches across the beat line
probe "25 a beam crosses the beat line" \
  src/lib/tab/rhythm-guide.ts \
  '    const sameBeat =
      previous !== undefined &&
      Math.floor(previous.slot / beatSlots) === Math.floor(onset.slot / beatSlots);' \
  '    const sameBeat = previous !== undefined;' \
  "$RG"

# 26 — a beam is drawn over silence
probe "26 a beam is drawn over a rest" \
  src/lib/tab/rhythm-guide.ts \
  '    const contiguous =
      previous !== undefined &&
      previous.slot + previous.durationTicks / step === onset.slot;' \
  '    const contiguous = previous !== undefined;' \
  "$RG"

# 27 — quarter notes are beamed, which no notation does
probe "27 a quarter note gets a beam" \
  src/lib/tab/rhythm-guide.ts \
  '  if (value >= QUARTER) return 0;' \
  '  if (value >= QUARTER * 4) return 0;' \
  "$RG"

# ------------------------------------------------------------- §8 the boundary

# 28 — a component reaches into the chain preflight directly
probe "28 a component imports the chain preflight" \
  src/components/workspace/ChainDecisionSheet.tsx \
  'import { Sheet, SheetButton } from "@/components/workspace/Sheet";' \
  'import { chainImpact } from "@/lib/song/chain-preflight";
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
void chainImpact;' \
  "$B"

# 29 — the Workspace grows past its budget
probe "29 the workspace line budget is exceeded" \
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

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
