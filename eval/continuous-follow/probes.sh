#!/usr/bin/env bash
# Vacuity probes for the continuous reading surface (2Q-C §14).
#
# Forty-seven mutations, each of which puts back a way this checkpoint's
# guarantees could be quietly untrue — an axis that stretches with tempo, a
# window whose three parts stop adding up, an anchor that drifts, a clamp that
# forgets the end of the song, a takeover that a programmatic scroll can
# trigger, a reduced-motion surface that scrolls every frame, a gesture that
# starts resolving against the DOM — and asserts that a named test really goes
# red.
#
# The mutation is always the *dangerous behaviour*, never a syntax error: a
# probe that only breaks compilation proves nothing about the test.
#
#   ./eval/continuous-follow/probes.sh
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
AXIS="$V src/lib/tab/song-axis.test.ts"
WINDOW="$V src/lib/ui/horizontal-window.test.ts"
FOLLOW="$V src/lib/ui/continuous-follow.test.ts"
PARITY="$V src/lib/ui/windowing-parity.test.ts"
BOUND="$V src/lib/ui/reading-surface-boundary.test.ts"
MODEL="$V src/lib/multitrack/model.test.ts"
NAV="$V src/lib/workspace/section-navigation.test.ts"
WS="$V src/lib/workspace/workspace-boundary.test.ts"

echo "--- the axis is one authority (§2) ---"

probe "1 a bar's width follows tempo instead of its slot count" \
  src/lib/tab/song-axis.ts "$AXIS $MODEL" \
  '      const widthPx = slots * slotWidthPx;' \
  '      const widthPx = slots * slotWidthPx * (song.bpm / 120);'

probe "2 bar width is proportional to tick duration" \
  src/lib/tab/song-axis.ts "$AXIS $MODEL" \
  '      const widthPx = slots * slotWidthPx;' \
  '      const widthPx = (durationTicks / 4) * slotWidthPx;'

probe "3 the axis restarts its ticks at each section" \
  src/lib/tab/song-axis.ts "$AXIS $MODEL" \
  '        startTicks,
        endTicks: startTicks + durationTicks,' \
  '        startTicks: startTicks - sectionStartTicks,
        endTicks: startTicks - sectionStartTicks + durationTicks,'

probe "4 a bar key drops its section and keeps only its index" \
  src/lib/tab/song-axis.ts "$AXIS $PARITY" \
  '        key: `${section.id}:${localBarIndex}`,' \
  '        key: `${localBarIndex}`,'

probe "5 an x outside the song is clamped instead of refused" \
  src/lib/tab/song-axis.ts "$AXIS $PARITY" \
  '  if (axis.bars.length === 0 || x < 0 || x > axis.totalWidthPx) return null;' \
  '  if (axis.bars.length === 0) return null;
  x = Math.max(0, Math.min(axis.totalWidthPx, x));'

probe "6 a tick outside the song is clamped instead of refused" \
  src/lib/tab/song-axis.ts "$AXIS $MODEL" \
  '  if (songTicks < 0) return null;' \
  '  songTicks = Math.max(0, Math.min(axis.totalTicks, songTicks));'

probe "7 x -> slot rounds to the nearest grid line" \
  src/lib/tab/song-axis.ts "$AXIS $PARITY" \
  '  const raw = slotWidth <= 0 ? 0 : Math.floor((x - bar.leftPx) / slotWidth);' \
  '  const raw = slotWidth <= 0 ? 0 : Math.round((x - bar.leftPx) / slotWidth);'

probe "8 the axis writes its own answer back into the song" \
  src/lib/tab/song-axis.ts "$AXIS $PARITY" \
  '    for (const [localBarIndex, bar] of section.bars.entries()) {' \
  '    for (const [localBarIndex, bar] of section.bars.entries()) {
      (bar as unknown as { leftPx: number }).leftPx = leftPx;'

probe "9 a section forgets where it starts" \
  src/lib/tab/song-axis.ts "$AXIS $NAV" \
  '      leftPx: sectionLeftPx,' \
  '      leftPx: 0,'

probe "10 the last tick of the song has no x" \
  src/lib/tab/song-axis.ts "$AXIS" \
  '  return songTicks === last.endTicks ? last : null;' \
  '  return null;'

echo "--- the window covers the viewport (§3) ---"

probe "11 the three parts stop adding up to the axis" \
  src/lib/ui/horizontal-window.ts "$WINDOW $PARITY" \
  '    afterPx: axis.totalWidthPx - beforePx - renderedPx,' \
  '    afterPx: 0,'

probe "12 before is measured from the window rather than the axis" \
  src/lib/ui/horizontal-window.ts "$WINDOW $PARITY" \
  '  const beforePx = bars[0]!.leftPx;' \
  '  const beforePx = 0;'

probe "13 the window drops the bar under the left edge" \
  src/lib/ui/horizontal-window.ts "$WINDOW $PARITY" \
  '    if (barRight <= from) continue;' \
  '    if (bar.leftPx < from) continue;'

probe "14 the window stops at the right edge with no overscan" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  '  const aheadPx = width * overscan.ahead;' \
  '  const aheadPx = 0;'

probe "15 the overscan stops following the reader's travel" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  '  const leftMargin = backward ? aheadPx : forward ? behindPx : aheadPx;
  const rightMargin = backward ? behindPx : aheadPx;' \
  '  const leftMargin = aheadPx;
  const rightMargin = aheadPx;'

probe "16 a scroll that has not moved is called forward" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  '  if (delta > DIRECTION_DEAD_BAND_PX) return "forward";' \
  '  if (delta >= 0) return "forward";'

probe "17 subpixel wobble flips the overscan" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  'export const DIRECTION_DEAD_BAND_PX = 0.5;' \
  'export const DIRECTION_DEAD_BAND_PX = 0;'

probe "18 two different ranges are called the same window" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  '  return a.firstBarIndex === b.firstBarIndex && a.lastBarIndex === b.lastBarIndex;' \
  '  return true;'

probe "19 the overscan is a fixed distance instead of a viewport fraction" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  '  const aheadPx = width * overscan.ahead;
  const behindPx = width * overscan.behind;' \
  '  const aheadPx = 34;
  const behindPx = 34;'

probe "20 an empty axis renders a bar that is not there" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  '  if (axis.bars.length === 0) return EMPTY;' \
  '  if (axis.bars.length === 0) return { ...EMPTY, firstBarIndex: 0, lastBarIndex: 0 };'

probe "21 the window runs past the end of the song" \
  src/lib/ui/horizontal-window.ts "$WINDOW" \
  '    if (bar.leftPx >= to) break;' \
  '    if (bar.leftPx > to + 100000) break;'

echo "--- the reading anchor (§5) ---"

probe "22 the anchor drifts to the middle of the screen" \
  src/lib/ui/continuous-follow.ts "$FOLLOW $PARITY" \
  'export const FOLLOW_ANCHOR_FRACTION = 0.32;' \
  'export const FOLLOW_ANCHOR_FRACTION = 0.5;'

probe "23 the anchor is a fixed pixel offset, not a fraction" \
  src/lib/ui/continuous-follow.ts "$FOLLOW $PARITY" \
  '  return Math.max(0, viewportWidthPx) * FOLLOW_ANCHOR_FRACTION;' \
  '  return 120;'

probe "24 the surface scrolls past the end of its content" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '  const maxScroll = Math.max(0, viewport.contentWidthPx - viewport.widthPx);
  return Math.min(maxScroll, Math.max(0, target));' \
  '  return Math.max(0, target);'

probe "25 the surface scrolls to a negative position at the start" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '  return Math.min(maxScroll, Math.max(0, target));' \
  '  return Math.min(maxScroll, target);'

probe "26 the tail is long enough for nothing" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '  return Math.max(0, viewportWidthPx) - anchorOffsetPx(viewportWidthPx);' \
  '  return 0;'

probe "27 following accumulates instead of following the position" \
  src/lib/ui/continuous-follow.ts "$FOLLOW $PARITY" \
  '  const target = playheadContentX - anchorOffsetPx(viewport.widthPx);' \
  '  const target = playheadContentX * 1.02 - anchorOffsetPx(viewport.widthPx);'

probe "28 a wheel no longer takes the view over" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '    case "user_scrolled":
    case "user_touched_surface":' \
  '    case "user_touched_surface":'

probe "29 a finger on a cell no longer takes the view over" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '    case "user_touched_surface":
    case "bar_operation":' \
  '    case "bar_operation":'

probe "30 a bar operation no longer takes the view over" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '    case "bar_operation":
    case "sheet_opened":' \
  '    case "sheet_opened":'

probe "31 pressing play does not hand the view back" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '    case "playback_started":
    case "playback_resumed":' \
  '    case "playback_resumed":'

probe "32 the explicit way back does not work" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '    case "return_to_playback":
    case "explicit_seek":' \
  '    case "explicit_seek":'

probe "33 a seek does not hand the view back" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '    case "explicit_seek":
      return state.manual ? { ...state, manual: false } : state;' \
  '    case "explicit_seek":
      return state;'

probe "34 an unchanged state is rebuilt every frame" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '      return state.manual ? state : { ...state, manual: true };' \
  '      return { ...state, manual: true };'

probe "35 reduced motion is forgotten under a takeover" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '  if (state.reduceMotion) return "reduced_motion";' \
  '  if (state.manual) return "manual";
  if (state.reduceMotion) return "reduced_motion";'

probe "36 a reduced-motion surface follows continuously anyway" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '  return !state.manual && !state.reduceMotion;' \
  '  return !state.manual;'

probe "37 a reduced-motion surface never catches up at all" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  '  if (inside) return null;' \
  '  return null;
  if (inside) return null;'

probe "38 a reduced-motion surface scrolls on every frame" \
  src/lib/ui/continuous-follow.ts "$FOLLOW" \
  'export const REDUCED_MOTION_MARGIN_FRACTION = 0.12;' \
  'export const REDUCED_MOTION_MARGIN_FRACTION = 0.49;'

echo "--- the whole song is one surface (§4) ---"

probe "39 the Çoklu model goes back to one section" \
  src/lib/multitrack/model.ts "$MODEL" \
  '  const lanes = song.tracks.map((track): MultiTrackLane => {' \
  '  const only = bars[0]?.sectionId;
  bars = bars.filter((bar) => bar.sectionId === only);
  const lanes = song.tracks.map((track): MultiTrackLane => {'

probe "40 a lane drops the bars of every section but the first" \
  src/lib/multitrack/model.ts "$MODEL" \
  '    if (timeline.kind === "fretted") {
      return {
        ...base,
        kind: "fretted",
        strings: timeline.strings,
        capo: timeline.capo,
        bars: timeline.bars,
      };' \
  '    if (timeline.kind === "fretted") {
      return {
        ...base,
        kind: "fretted",
        strings: timeline.strings,
        capo: timeline.capo,
        bars: timeline.bars.filter((bar) => bar.sectionId === bars[0]?.sectionId),
      };'

probe "41 a section start is marked on every bar" \
  src/lib/multitrack/model.ts "$MODEL" \
  '        isSectionStart: barIndex === 0,' \
  '        isSectionStart: true,'

probe "42 bar numbers restart at each section" \
  src/lib/multitrack/model.ts "$MODEL" \
  '      barNumber += 1;' \
  '      barNumber = barIndex + 1;'

probe "43 a pitched lane reads every bar out of the first section" \
  src/lib/multitrack/model.ts "$MODEL" \
  '    const slots = sections.get(bar.sectionId)?.bars[bar.barIndex]?.slots[track.id];' \
  '    const slots = song.sections[0]?.bars[bar.barIndex]?.slots[track.id];'

echo "--- the boundaries (§15) ---"

probe "44 a canvas starts doing its own tick arithmetic" \
  src/components/workspace/TabCanvas.tsx "$BOUND" \
  '      const axisX = xAtTicks(axis, position.ticks);' \
  '      const axisX = xAtTicks(axis, position.ticks + 0);'

probe "45 a canvas holds its own copy of the reading anchor" \
  src/components/workspace/MultiTrackCanvas.tsx "$BOUND" \
  'const LANE_BODY_HEIGHT = 120;' \
  'const LANE_BODY_HEIGHT = 120;
const ANCHOR = 0.32;'

probe "46 the surface hook reaches storage" \
  src/lib/workspace/use-reading-surface.ts "$BOUND" \
  'import { SLOT_WIDTH } from "@/components/workspace/geometry";' \
  'import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { loadProjects } from "@/lib/song/storage";'

probe "47 the window reaches for React" \
  src/lib/ui/horizontal-window.ts "$BOUND" \
  'import type { SongAxis, SongAxisBar } from "@/lib/tab/song-axis";' \
  'import { useMemo } from "react";
import type { SongAxis, SongAxisBar } from "@/lib/tab/song-axis";'

echo
echo "$pass red, $fail vacuous, $skipped skipped"
exit $(( fail > 0 ? 1 : 0 ))
