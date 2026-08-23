#!/usr/bin/env bash
# Vacuity probes for the playhead lifecycle (2N-A.1).
#
# Six ways the loop could quietly become a battery drain, and one way the
# measurement could quietly stop measuring it. The last is the one that
# matters most here: this whole checkpoint exists because a number was
# reported under the wrong name, so a probe that breaks the harness and still
# sees green would mean the fix is decorative.
#
# The pure ones run against the unit suite in a second. The three that live in
# a component need the browser harness, which needs a production build — so
# they rebuild, and they are slow on purpose rather than approximated.
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

L="npx vitest run src/lib/workspace/playhead-loop.test.ts"
B="npx vitest run src/lib/workspace/workspace-boundary.test.ts"
# The browser probes rebuild and restart, because a mutation that never
# reaches the bundle would be measured against the previous build's code.
BROWSER="npm run build && (fuser -k 3100/tcp 2>/dev/null; sleep 1; npx next start -p 3100 & sleep 5) && node eval/tab/playhead.mjs"

# 1 — the loop keeps asking for frames when the transport is stopped
probe "1 the loop keeps running while idle" \
  src/lib/workspace/playhead-loop.ts \
  '    if (running) ask();' \
  '    ask();' \
  "$L"

# 2 — cleanup no longer cancels, so an unmount leaves a frame owed
probe "2 unmount does not cancel the outstanding frame" \
  src/lib/workspace/playhead-loop.ts \
  '    scheduler.cancel(handle);' \
  '' \
  "$L"

# 3 — a mount starts two loops, so every view switch adds one
probe "3 a mount starts a second loop" \
  src/lib/workspace/playhead-loop.ts \
  '  ask();

  return () => {' \
  '  ask();
  ask();

  return () => {' \
  "$L"

# 4 — a component reaches for a frame of its own again
probe "4 a surface takes back its own animation frame" \
  src/components/workspace/TabCanvas.tsx \
  '    return runPlayheadLoop({ source: "tab", running, draw });' \
  '    let frame = requestAnimationFrame(function tick() {
      draw();
      if (running) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);' \
  "$B"

# 5 — pausing no longer reaches the loop: the tab always claims to be running
probe "5 pause does not stop the loop" \
  src/components/workspace/TabCanvas.tsx \
  '    return runPlayheadLoop({ source: "tab", running, draw });' \
  '    return runPlayheadLoop({ source: "tab", running: true, draw });' \
  "$BROWSER"

# 6 — the effect stops watching `running`, so the loop that was following the
#     old plan survives the timing change that stopped playback
probe "6 the old loop outlives the transport that stopped" \
  src/components/workspace/TabCanvas.tsx \
  '  }, [
    running,
    plan,' \
  '  }, [
    plan,' \
  "$BROWSER"

# 7 — the harness goes back to reporting the display's frame rate as the
#     playhead's, which is exactly the error this checkpoint is about
probe "7 the measurement counts global rAF instead of the hook" \
  eval/tab/playhead.mjs \
  '      drawn: delta("drawn", "tab"),' \
  '      drawn: globalRaf,' \
  "node eval/tab/playhead.mjs"

# Leave the bundle — and the measurement file every browser probe overwrote —
# as the committed sources describe them. Without this last clean pass the
# JSON on disk is the *last mutation's* lifecycle, which reads as a real
# regression, and the running server still serves mutated code.
npm run build >/dev/null 2>&1
fuser -k 3100/tcp >/dev/null 2>&1
sleep 1
(npx next start -p 3100 >/dev/null 2>&1 &)
sleep 5
node eval/tab/playhead.mjs >/dev/null 2>&1
clean=$?

echo
echo "RED: $pass  VACUOUS: $fail"
if [ "$clean" -ne 0 ]; then
  echo "WARNING: the clean re-measurement did not pass — PLAYHEAD.json is not trustworthy"
fi
[ "$fail" -eq 0 ] && [ "$clean" -eq 0 ]
