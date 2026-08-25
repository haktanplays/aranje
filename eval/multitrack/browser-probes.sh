#!/usr/bin/env bash
# 2Q-A vacuity probes that need the real browser (§18).
#
# Four mutations against guarantees no unit test can hold, because they are
# facts about layout and gestures rather than about data: a lane header that
# does not move the reader's view, the follow etiquette, and the single
# horizontal scroller as the DOM actually reports it. Each breaks a
# guarantee, rebuilds, and asserts that the named acceptance scenarios go red.
#
# The two transport probes moved to eval/cross-instrument at 2Q-B; see below.
#
# The unit-suite probes live in probes.sh.
#
#   ./eval/chord-audio/serve.sh   # once, for the clean baseline
#   ./eval/multitrack/browser-probes.sh
set -u

pass=0; fail=0; skipped=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
}

# probe <name> <file> <scenarios> <viewports> <find> <repl>
probe() {
  local name="$1" file="$2" only="$3" one="$4" find="$5" repl="$6"
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
  if [ $? -ne 0 ]; then
    echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"
    skipped=$((skipped+1)); return
  fi

  if npm run build >/dev/null 2>&1; then
    restart
    if MULTI_ONLY="$only" ONE_VIEWPORT="$one" node eval/multitrack/verify.mjs \
        >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) senaryo)"
      pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# The two 320px transport probes that used to live here moved to
# `eval/cross-instrument/browser-probes.sh` at 2Q-B (§10). The rule they
# protect is unchanged — the whole transport has to be reachable on a narrow
# phone — but the surface it is measured on grew: the row now also has to
# survive the reader's 125% and 150% text settings, and those runs only exist
# in the 2Q-B harness. Leaving stale copies here would have meant two probes
# anchored on markup that no longer exists, silently skipping.

echo "--- şerit dokunuşu ve takip (§6, §8) ---"

# 34 — the lane header goes back inside the scrolling content
# Scenario 22 is not the one that owns this any more: with the follow
# etiquette in place, a lane tap leaves the view alone whether or not the
# header is sticky. What the sticky header owns is scenario 54 — the header
# still being on screen after the notation has scrolled under it.
probe "34 the lane header scrolls away with the notation" \
  src/components/workspace/MultiTrackLane.tsx "54 ,22 " "1" \
  'className="sticky left-0 flex w-screen max-w-full items-stretch gap-1 px-2"' \
  'className="flex items-stretch gap-1 px-2"'

# 35 — following never stops, so a re-render drags the view back to the playhead
probe "35 a manual scroll no longer takes the view" \
  src/components/workspace/use-scroll-takeover.ts "51 ,52 ,22 " "1" \
  '      userScrolled.current = true;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });' \
  '      userScrolled.current = false;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });'

echo "--- tek scroller ve tek playhead (§6, §7) ---"

# 36 — a lane gets a scroller of its own, in the DOM rather than in the source
probe "36 each lane scrolls horizontally on its own" \
  src/components/workspace/MultiTrackLane.tsx "13 ,14 ,15 " "1" \
  '      <div className="sticky left-0 flex w-screen max-w-full items-stretch gap-1 px-2">' \
  '      <div className="overflow-x-auto sticky left-0 flex w-screen max-w-full items-stretch gap-1 px-2">'

# 37 — the playhead is drawn while the reader is reading another section
#
# Two guards stand between a wrong line and the screen: the bar lookup returns
# nothing for a bar this section does not hold, and the visibility flag hides
# the column when the music is elsewhere. Mutating either one alone is inert,
# because the other still catches it — which is worth knowing and is written
# down in the report. The dangerous behaviour is drawing anyway, so this probe
# removes both in the one block they share.
probe "37 a playhead is drawn for music that is somewhere else" \
  src/components/workspace/MultiTrackCanvas.tsx "12 " "1" \
  '      const bar = position.barKey
        ? axis.bars.find((entry) => entry.key === position.barKey)
        : undefined;
      const x = bar ? bar.x + position.barProgress * bar.width : null;

      if (element) {
        if (x === null || !playheadVisible) {' \
  '      const bar =
        (position.barKey
          ? axis.bars.find((entry) => entry.key === position.barKey)
          : undefined) ?? axis.bars[0];
      const x = bar ? bar.x + position.barProgress * bar.width : null;

      if (element) {
        if (x === null) {'

echo
echo "kırmızı $pass · yeşil(vacuous) $fail · atlanan $skipped"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
