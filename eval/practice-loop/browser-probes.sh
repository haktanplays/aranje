#!/usr/bin/env bash
# 2R-A vacuity probes that need a real browser (§XVI).
#
# Ten mutations against guarantees no node test can hold, because each is a
# fact about the page rather than about data: a key that closes a sheet, a
# spacer nobody may tap, a window that mounts a fraction of its grid, a frame
# counter that only a browser increments, a count-in scheduled on the audio
# clock. Each one breaks the guarantee, rebuilds the production app, runs the
# named acceptance tour and asserts that it goes red.
#
# The unit, AST and behaviour probes live in `probes.sh`.
#
#   ./eval/chord-audio/serve.sh   # once, for the clean baseline
#   ./eval/practice-loop/browser-probes.sh
set -u

pass=0; fail=0; skipped=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
}

# probe <name> <file> <tours> <find1> <repl1> [<find2> <repl2> ...]
probe() {
  local name="$1" file="$2" only="$3"; shift 3
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

  if npm run build >/dev/null 2>&1; then
    restart
    if ONLY="$only" ONE_VIEWPORT=1 ONE_SCALE=1 node eval/practice-loop/verify.mjs \
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

echo "--- the sheet's one way out (§X) ---"

probe "B1 Escape no longer closes a sheet" \
  src/components/workspace/Sheet.tsx "speed" \
  '      if (event.key === "Escape") onClose();' \
  '      if (event.key === "Enter") onClose();'

echo "--- the reading tail is scenery (§III) ---"

probe "B2 the reading tail is counted as a bar" \
  src/components/workspace/TabCanvas.tsx "extent" \
  '            data-tab-tail' \
  '            data-tab-tail
            data-bar-key="tail"'

probe "B3 the armed grid is drawn at the window's x instead of its own" \
  src/lib/workspace/use-armed-grid-row.ts "parity" \
  '  const gridLeadPx = model ? (xAtSection(surface.axis, model.sectionId) ?? 0) : null;' \
  '  const gridLeadPx = model ? 0 : null;'

echo "--- the window is a window (§6) ---"

probe "B4 the kit grid mounts every column it has" \
  src/lib/ui/drum-grid-window.ts "grid" \
  'export const DRUM_GRID_OVERSCAN: DrumGridOverscan = { ahead: 1, behind: 0.5 };' \
  'export const DRUM_GRID_OVERSCAN: DrumGridOverscan = { ahead: 400, behind: 400 };'

probe "B5 a cell is addressed one slot away from where it is drawn" \
  src/lib/tab/drum-step-model.ts "grid" \
  '          ticks: bar.startTicks + slotIndex * perSlot,' \
  '          ticks: bar.startTicks + slotIndex * perSlot + perSlot,'

echo "--- one frame owner, one engine (§XI) ---"

probe "B6 a frame that has been drawn is still counted as owed" \
  src/lib/workspace/playhead-loop.ts "runtime" \
  '    owed = false;
    bump("live", source, -1);' \
  '    owed = false;'

echo "--- the count-in, and what cancels it (§VIII) ---"

probe "B7 a cancelled count-in leaves its token behind" \
  src/lib/audio/playback.ts "cancel" \
  '  private cancelCountIn(): void {
    if (this.countInToken === null) return;
    this.countInToken = null;' \
  '  private cancelCountIn(): void {
    if (this.countInToken === null) return;'

probe "B8 the music starts under the count-in instead of after it" \
  src/lib/audio/playback.ts "countin44" \
  '        transport.start(now + wait);' \
  '        transport.start(now);'

echo "--- one loop at a time, and one honest line about it (§VII, §X) ---"

probe "B9 the section loop no longer replaces the practice range" \
  src/lib/workspace/use-practice-session.ts "loop" \
  '    if (state.loop.kind !== "section") setRangeState(null);' \
  '    if (state.loop.kind === "section") setRangeState(null);'

probe "B10 the transport says nothing about an active drill" \
  src/components/workspace/TransportBar.tsx "loop" \
  '            <span data-practice-banner className="text-bronze block">
              {practice.banner}
            </span>' \
  '            <span className="text-bronze block">{practice.banner}</span>'

echo "--- the models are built when they are looked at (§3) ---"

probe "B11 the count-in setting is written to the device" \
  src/lib/workspace/use-practice-session.ts "boundary" \
  '    setCountIn: setCountInBars,' \
  '    setCountIn: (bars: CountInBars) => {
      window.localStorage.setItem("aranje.settings", JSON.stringify({ countIn: bars }));
      setCountInBars(bars);
    },'

echo
echo "$pass red, $fail vacuous, $skipped skipped"
echo "rebuilding the clean artefact server"
./eval/chord-audio/serve.sh
exit $(( fail > 0 ? 1 : 0 ))
