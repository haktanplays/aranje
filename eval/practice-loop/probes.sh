#!/usr/bin/env bash
# Vacuity probes for the practice loop and the windowed kit grid (2R-A §19).
#
# Each probe puts back a way one of this checkpoint's guarantees could be
# quietly untrue — a grid that answers with the wrong section, a harness that
# measures the same section four times, a count-in nothing cancels, a loop that
# leaks into the project file — and asserts that a named test really goes red.
#
# The mutation is always the *dangerous behaviour*, never a syntax error: a
# probe that only breaks compilation proves nothing about the test.
#
#   ./eval/practice-loop/probes.sh
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
API="$V src/lib/tab/drum-step-api.test.ts"
RANGE="$V src/lib/practice/range.test.ts"
ENTRY="$V src/lib/practice/range-entry.test.ts"
PRE="$V src/lib/practice/range-preflight.test.ts"
COUNTIN="$V src/lib/practice/count-in.test.ts"
AUDIO="$V src/lib/audio/playback-count-in.test.ts"
PROG="$V src/lib/practice/progressive-rate.test.ts"
DRAFT="$V src/lib/practice/speed-draft.test.ts"
WORDS="$V src/lib/practice/messages.test.ts"
SESSION="$V src/lib/practice/session-boundary.test.ts"
BOUND="$V src/lib/practice/practice-boundary.test.ts"
ROW="$V src/lib/ui/reading-row.test.ts"
GRID="$V src/lib/ui/drum-grid-window.test.ts"
LAZY="$V src/lib/ui/lazy-value.test.ts"
MODEL="$V src/lib/tab/drum-step-model.test.ts"
WS="$V src/lib/workspace/workspace-boundary.test.ts"
FRAME="$V src/lib/workspace/playhead-loop.test.ts"

echo "--- the kit grid is asked for by name (§2) ---"

probe "1 the builder reads the two ids the other way round" \
  src/lib/tab/drum-step-model.ts "$API" \
  '  const section = song.sections.find((entry) => entry.id === sectionId);' \
  '  const section = song.sections.find((entry) => entry.id === trackId);' \
  '  if (!song.tracks.some((track) => track.id === trackId)) return null;' \
  '  if (!song.tracks.some((track) => track.id === sectionId)) return null;'

probe "2 an unknown section falls back to the first one again" \
  src/lib/tab/drum-step-model.ts "$API" \
  '  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section) return null;' \
  '  const section =
    song.sections.find((entry) => entry.id === sectionId) ?? song.sections[0];
  if (!section) return null;'

probe "3 the overscan harness measures every fixture on section one" \
  eval/practice-loop/measure-overscan.ts "$API" \
  '    const model = buildDrumStepModel({ song, sectionId: section.id, trackId });' \
  '    const model = buildDrumStepModel({
      song,
      sectionId: song.sections[0]?.id ?? section.id,
      trackId,
    });'

echo "--- a range is whole bars in one section (§8, §9) ---"

probe "4 a pair spanning two sections is accepted" \
  src/lib/practice/range.ts "$RANGE $ENTRY" \
  '  if (first.sectionId !== second.sectionId) {
    return { ok: false, reason: "different_sections" };
  }' \
  '  if (false) {
    return { ok: false, reason: "different_sections" };
  }'

probe "5 a backwards pair is resolved in the order it was given" \
  src/lib/practice/range.ts "$RANGE $ENTRY" \
  '  const from = Math.min(first.localBarIndex, second.localBarIndex);
  const to = Math.max(first.localBarIndex, second.localBarIndex);' \
  '  const from = first.localBarIndex;
  const to = second.localBarIndex;'

probe "6 a range longer than a section is allowed through" \
  src/lib/practice/range.ts "$RANGE" \
  '  if (to - from + 1 > songLimits.barsPerSection) {' \
  '  if (to - from + 1 > songLimits.barsPerSection * 4) {'

probe "7 the loop end becomes inclusive" \
  src/lib/practice/range.ts "$RANGE" \
  '  const endTicks = last.time + last.durationTicks;' \
  '  const endTicks = last.time + last.durationTicks - 1;'

probe "8 a stale range keeps looping whatever slid into its bars" \
  src/lib/practice/range.ts "$RANGE" \
  '  return (
    from.localBarIndex <= to.localBarIndex &&
    to.localBarIndex < section.bars.length
  );' \
  '  return from.localBarIndex <= to.localBarIndex;'

probe "9 a range whose last bar is gone loops to the end of the song" \
  src/lib/practice/range.ts "$RANGE" \
  '  if (!first || !last) return null;' \
  '  if (!first) return null;
  if (!last) return { startTicks: first.time, endTicks: plan.totalTicks };'

echo "--- the three doors, and what they refuse (§V) ---"

probe "10 a partial time selection becomes a range" \
  src/lib/practice/range-entry.ts "$ENTRY" \
  '  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return { ok: false, reason: "requires_full_bars" };
  }' \
  '  if (endIndex <= startIndex) {
    return { ok: false, reason: "requires_full_bars" };
  }'

probe "11 a selection is snapped to the nearest bar instead of refused" \
  src/lib/practice/range-entry.ts "$ENTRY" \
  '  const startIndex = boundaries.indexOf(selection.startTicks);
  const endIndex = boundaries.indexOf(selection.endTicks);' \
  '  const near = (ticks: number) =>
    boundaries.reduce(
      (best, at, index) =>
        Math.abs(at - ticks) < Math.abs(boundaries[best]! - ticks) ? index : best,
      0,
    );
  const startIndex = near(selection.startTicks);
  const endIndex = near(selection.endTicks);'

probe "12 the chain preflight is skipped at the door" \
  src/lib/practice/range-entry.ts "$ENTRY" \
  '  const decision = rangeDecision(rangePreflight(song, result.range));
  if (decision.kind === "blocked") {
    return { ok: false, reason: "chain_crosses_section" };
  }' \
  '  const decision = rangeDecision(rangePreflight(song, result.range));
  if (decision.kind === "include_connection") {
    return { ok: false, reason: "chain_crosses_section" };
  }'

probe "13 the offer predicate is looser than the conversion" \
  src/lib/practice/range-entry.ts "$ENTRY" \
  'export function offersPracticeRange(song: Song, selection: TimeSelection): boolean {
  return rangeFromTimeSelection(song, selection).ok;' \
  'export function offersPracticeRange(song: Song, selection: TimeSelection): boolean {
  return selection.endTicks > selection.startTicks;'

echo "--- what the edges cut, and the seam (§VI) ---"

probe "14 a chain across a section boundary stops blocking" \
  src/lib/practice/range-preflight.ts "$PRE $ENTRY" \
  '    return { kind: "blocked", reason: "crosses_section" };' \
  '    return { kind: "no_chain_impact" };'

probe "15 the include offer widens by less than the chain needs" \
  src/lib/practice/range-preflight.ts "$PRE" \
  '  const widened = practiceRange(' \
  '  const widened = ((song, a, b) => practiceRange(song, b, b))('

probe "16 a safe range reports an edge it does not have" \
  src/lib/practice/range-preflight.ts "$PRE" \
  'const SAFE: RangePreflight = { kind: "safe", findings: [], widened: null };' \
  'const SAFE: RangePreflight = { kind: "end_cuts_sustain", findings: [], widened: null };'

echo "--- counting in (§VIII) ---"

probe "17 the count-in counts written beats instead of felt ones" \
  src/lib/practice/count-in.ts "$COUNTIN" \
  '  const beats = feltBeatsIn(input.firstBar);' \
  '  const beats = input.firstBar.timeSignature[0];'

probe "18 the count-in ignores the practice rate" \
  src/lib/practice/count-in.ts "$COUNTIN" \
  '  const bpm = effectiveBpm(input.bpm, input.practicePercent);' \
  '  const bpm = input.bpm;'

probe "19 a count-in that is off still clicks" \
  src/lib/practice/count-in.ts "$COUNTIN" \
  '  if (input.bars === 0) return [];' \
  '' \
  '  const total = beats * input.bars;' \
  '  const total = beats * Math.max(1, input.bars);'

probe "20 two bars count the same as one" \
  src/lib/practice/count-in.ts "$COUNTIN" \
  '  const total = beats * input.bars;' \
  '  const total = beats;'

probe "21 a second play press stacks a second count-in" \
  src/lib/audio/playback.ts "$AUDIO" \
  '      if (this.countInToken !== null) return;' \
  '      if (this.countInToken === undefined) return;'

probe "22 the music starts under the count-in instead of after it" \
  src/lib/audio/playback.ts "$AUDIO" \
  '        transport.start(now + wait);' \
  '        transport.start(now);'

probe "23 cancelling forgets to stop the pending start" \
  src/lib/audio/playback.ts "$AUDIO" \
  '      // The start was scheduled for a moment that has not arrived.
      transport.stop();' \
  '      // The start was scheduled for a moment that has not arrived.'

probe "24 pausing no longer cancels the count-in" \
  src/lib/audio/playback.ts "$AUDIO" \
  '  private cancelCountIn(): void {
    if (this.countInToken === null) return;' \
  '  private cancelCountIn(): void {
    if (this.countInToken !== null) return;'

echo "--- getting faster, and only on a real pass (§IX) ---"

probe "25 the speed steps on something other than a completed pass" \
  src/lib/practice/progressive-rate.ts "$PROG" \
  '  if (atThisSpeed < state.plan.repeatsPerStep) {' \
  '  if (false) {'

probe "26 the climb overshoots its target on the last step" \
  src/lib/practice/progressive-rate.ts "$PROG" \
  '      percent: state.plan.toPercent,
      completedLoops,
      loopsAtThisSpeed: 0,
      stopped: "reached_target",' \
  '      percent: rung,
      completedLoops,
      loopsAtThisSpeed: 0,
      stopped: "reached_target",'

probe "27 a hand on the control no longer stops it" \
  src/lib/practice/progressive-rate.ts "$PROG" \
  '    stopped: state.stopped ?? "manual_change",' \
  '    stopped: state.stopped ?? null,'

probe "28 a target below the start is silently swapped" \
  src/lib/practice/progressive-rate.ts "$PROG $DRAFT" \
  '  if (to <= from) return { ok: false, reason: "target_not_above_start" };' \
  '  if (to < from) return { ok: true, plan: { fromPercent: to, toPercent: from, stepPercent: MIN_STEP_PERCENT, repeatsPerStep } };'

probe "29 the increment is clamped instead of refused" \
  src/lib/practice/progressive-rate.ts "$PROG $DRAFT" \
  '    return { ok: false, reason: "increment_out_of_range" };' \
  '    step = progressiveRateLimits.minIncrementPercent;'

probe "30 a fractional repeat count is accepted" \
  src/lib/practice/progressive-rate.ts "$PROG" \
  '    !Number.isInteger(repeatsPerStep) ||' \
  '    false ||'

probe "31 the automation lands on speeds the manual control has no rung for" \
  src/lib/practice/progressive-rate.ts "$PROG" \
  '  const rung = clampPercent(
    Math.round(raw / practiceRateLimits.stepPercent) * practiceRateLimits.stepPercent,
  );
  const next = Math.min(state.plan.toPercent, Math.max(rung, state.percent));' \
  '  const next = Math.min(state.plan.toPercent, raw);'

echo "--- the speed form's own limits (§X) ---"

probe "32 a control clamps at its end instead of refusing" \
  src/lib/practice/speed-draft.ts "$DRAFT" \
  '  if (next < range.min || next > range.max) return null;
  return { ...draft, [field]: next };' \
  '  return { ...draft, [field]: Math.min(range.max, Math.max(range.min, next)) };'

probe "33 a field borrows another field'\''s range" \
  src/lib/practice/speed-draft.ts "$DRAFT" \
  '  repeatsPerStep: {
    min: progressiveRateLimits.minRepeatsPerStep,
    max: progressiveRateLimits.maxRepeatsPerStep,
    step: 1,
  },' \
  '  repeatsPerStep: {
    min: practiceRateLimits.minPercent,
    max: practiceRateLimits.maxPercent,
    step: 1,
  },'

probe "34 the form opens on a constant instead of the reader'\''s speed" \
  src/lib/practice/speed-draft.ts "$DRAFT" \
  '  const to = Math.min(
    practiceRateLimits.maxPercent,
    Math.max(practiceRateLimits.minPercent, currentPercent),
  );' \
  '  const to = practiceRateLimits.defaultPercent;'

echo "--- what the reader is told (§14, §12) ---"

probe "35 the banner keeps advertising a climb that has stopped" \
  src/lib/practice/messages.ts "$WORDS" \
  '  const plan = input.progressive?.stopped === null ? input.progressive.plan : null;' \
  '  const plan = input.progressive?.plan ?? null;'

probe "36 the banner reports the plan'\''s start rather than where it is now" \
  src/lib/practice/messages.ts "$WORDS" \
  '    parts.push(`%${input.progressive?.percent}→%${plan.toPercent}`);' \
  '    parts.push(`%${plan.fromPercent}→%${plan.toPercent}`);'

probe "37 a refusal is shown as its own identifier" \
  src/lib/practice/messages.ts "$WORDS" \
  '      return "Çalışma döngüsü tek bir bölüm içinde kalır. İki ölçüyü aynı bölümden seç.";' \
  '      return `Hata: ${reason}`;'

probe "38 the progressive explainer stops saying the app does not listen" \
  src/lib/practice/messages.ts "$WORDS" \
  '  "Her tamamlanan turda bir kademe hızlanır. Uygulama çalımını dinlemez.";' \
  '  "Her doğru çalınan turda bir kademe hızlanır.";'

echo "--- the session-only boundary (§XI) ---"

probe "39 a practice field is written into the song" \
  src/lib/song/schema.ts "$SESSION" \
  'export const sectionSchema = z.strictObject({' \
  'export const sectionSchema = z.object({'

probe "40 the fingerprint starts carrying a practice field" \
  src/lib/copilot/fingerprint.ts "$SESSION" \
  'export function canonicalJson(value: unknown): string {' \
  'export function canonicalJson(value: unknown): string {
  if (value && typeof value === "object" && "sections" in (value as object)) {
    value = { ...(value as object), practiceRange: null };
  }'

probe "41 the practice hook reaches storage" \
  src/lib/workspace/use-practice-session.ts "$BOUND" \
  'import { barTimeline } from "@/lib/audio/schedule";' \
  'import { loadProjects } from "@/lib/song/storage";
import { barTimeline } from "@/lib/audio/schedule";'

probe "42 the practice sheet reaches the transport" \
  src/components/workspace/PracticeSheet.tsx "$BOUND" \
  'import { COUNT_IN_CHOICES, countInLabel } from "@/lib/practice/count-in";' \
  'import { createEngine } from "@/lib/audio/engine";
import { COUNT_IN_CHOICES, countInLabel } from "@/lib/practice/count-in";'

probe "43 a practice module reaches for the Copilot" \
  src/lib/practice/range.ts "$BOUND" \
  'import { songLimits } from "@/lib/limits";' \
  'import { buildFingerprint } from "@/lib/copilot/fingerprint";
import { songLimits } from "@/lib/limits";'

probe "44 the practice loop schedules a second animation frame" \
  src/lib/workspace/use-practice-session.ts "$BOUND" \
  '  const runAt = useCallback(' \
  '  const spare = () => requestAnimationFrame(() => undefined);
  const runAt = useCallback('

echo "--- the windowed extent (§III, §6) ---"

probe "45 the armed grid is drawn beside the spacers instead of in place of them" \
  src/lib/ui/reading-row.ts "$ROW" \
  '  const leadPx = input.armedGrid ? input.armedGrid.leadPx : input.windowBeforePx;
  const drawnPx = input.armedGrid ? input.armedGrid.widthPx : input.windowRenderedPx;' \
  '  const leadPx = input.windowBeforePx;
  const drawnPx = input.armedGrid
    ? input.windowRenderedPx + input.armedGrid.widthPx
    : input.windowRenderedPx;'

probe "46 the total extent follows how many bars are mounted" \
  src/lib/ui/reading-row.ts "$ROW" \
  '  const remainder = input.contentWidthPx - input.originPx - leadPx - drawnPx;' \
  '  const remainder = input.contentWidthPx - input.originPx - drawnPx;'

probe "47 the reading tail is counted as musical width" \
  src/lib/ui/reading-row.ts "$ROW" \
  '    totalPx: input.originPx + leadPx + drawnPx + tailPx,' \
  '    totalPx: input.originPx + leadPx + drawnPx,'

probe "48 the window shortens the grid it is a window onto" \
  src/lib/ui/drum-grid-window.ts "$GRID" \
  '    afterPx: axis.totalWidthPx - beforePx - renderedPx,' \
  '    afterPx: 0,'

probe "49 the last column falls outside every window" \
  src/lib/ui/drum-grid-window.ts "$GRID" \
  '      : Math.max(firstColumn, Math.min(last, Math.ceil(to / slot) - 1));' \
  '      : Math.max(firstColumn, Math.min(last - 1, Math.ceil(to / slot) - 1));'

probe "50 a cell is addressed by its slot rather than by its tick" \
  src/lib/tab/drum-step-model.ts "$MODEL $API" \
  '          ticks: bar.startTicks + slotIndex * perSlot,' \
  '          ticks: slotIndex,'

echo "--- the lazy models (§3) ---"

probe "51 a thunk is built eagerly, before anything asks for it" \
  src/lib/ui/lazy-value.ts "$LAZY" \
  '  let built: { value: T } | null = null;' \
  '  let built: { value: T } | null = { value: build() };'

probe "52 a thunk rebuilds on every call" \
  src/lib/ui/lazy-value.ts "$LAZY" \
  '    built ??= { value: build() };' \
  '    built = { value: build() };'

echo "--- the budgets and the single owner (§XII) ---"

probe "53 the composition root grows past its budget" \
  src/components/workspace/Workspace.tsx "$WS" \
  'export function Workspace(' \
  '/*
 * A block of comment lines standing in for real growth, so the budget test
 * is measured against a file that got longer rather than against a mutation
 * it could not see.
 */
/* 1 */
/* 2 */
/* 3 */
/* 4 */
/* 5 */
/* 6 */
/* 7 */
/* 8 */
export function Workspace('

probe "54 a frame that has been drawn is still counted as owed" \
  src/lib/workspace/playhead-loop.ts "$FRAME" \
  '    owed = false;
    bump("live", source, -1);' \
  '    owed = false;'

echo
echo "$pass red, $fail vacuous, $skipped skipped"
exit $(( fail > 0 ? 1 : 0 ))
