#!/usr/bin/env bash
# Vacuity probes that need the real browser.
#
# Six guarantees that no unit test can see: which gesture starts which
# selection, whether a ghost writes, whether a refusal is visible, whether the
# transport stops before the bars under it move, and whether a position
# survives a change to the song's structure. Each one breaks the guarantee,
# rebuilds, and asserts the acceptance run actually goes red.
#
# Slow on purpose: a production build per probe, because the acceptance run is
# against the production build and a dev-server answer would not be the same
# answer.
#
#   bash eval/bar-ops/browser-probes.sh
set -u

pass=0; fail=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1
  sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &)
  sleep 5
}

probe() {
  local name="$1" file="$2" find="$3" repl="$4"
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

  if npm run build >/dev/null 2>&1; then
    restart
    if node eval/bar-ops/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"
      pass=$((pass+1))
    fi
  else
    # A mutation that does not compile proves nothing about the checks.
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 13 — a ghost is a reading, not a write
#
# First aimed at committing twice, which came back green: both commits pass the
# same song object, React bails out of the second, and one write is what the
# counter sees. That is a true statement about the store, not about the
# guarantee — so the probe now makes the *preview* commit, which is the thing
# "a preview writes nothing" is actually about.
probe "13 the preview commits what it is showing" \
  src/lib/song/use-bar-transform.ts \
  '  const stage = useCallback((command: BarCommand) => {
    setPending(command);
    setError(null);
  }, []);' \
  '  const stage = useCallback(
    (command: BarCommand) => {
      setPending(command);
      setError(null);
      if (!selection) return;
      const ghost = applyBarCommand(store.getSnapshot().song, selection, command);
      if (ghost.ok) store.commit(ghost.song);
    },
    [selection, store],
  );'

# 14 — one press, one selection model
probe "14 a tab bar press also wakes the time selection" \
  src/components/workspace/FrettedBarBlock.tsx \
  '          if (!onBarLongPress) return;
          event.stopPropagation();' \
  '          if (!onBarLongPress) return;'

# 15 — a ghost is not an interruption
#
# First aimed at removing the explicit pause before a structural write, which
# came back green — and that is a real finding rather than a bad probe: a song
# change replaces the controller anyway, so the transport stops either way and
# no check can tell the two apart. The pause stays as a statement of intent,
# but the guarantee with teeth is the other half of the same rule: a *preview*
# must not stop the music, and nothing else makes that true.
probe "15 a preview stops the music" \
  src/components/workspace/Workspace.tsx \
  '    (command: BarCommand) => {
      setBarSheet(null);
      barTransform.stage(command);
    },
    [barTransform],' \
  '    (command: BarCommand) => {
      setBarSheet(null);
      controller.pause();
      barTransform.stage(command);
    },
    [barTransform, controller],'

# 16 — a refusal that takes the selection with it is still spoken
probe "16 the refusal is hidden with the selection" \
  src/components/workspace/Workspace.tsx \
  '          data-bar-error
          role="alert"' \
  '          role="alert"'

# 17 — a position survives a change to the structure
#
# The scenario behind this one used to start the playhead at bar one, where a
# transport that had lost its place would also be — so it passed with the carry
# removed. It now puts the playhead in a different section from the edit.
probe "17 the playhead is thrown back to the start" \
  src/lib/audio/use-playback.ts \
  '    if (at !== null) next.seekToNearestBar(at);' \
  ''

# 18 — a cell press is that track's bars, not everyone's
probe "18 a cell press selects every track" \
  src/components/workspace/ArrangementCanvas.tsx \
  '                        onSelectBars?.({
                          barIndex: bar.barIndex,
                          sectionId: bar.sectionId,
                          trackId: track.trackId,
                        });' \
  '                        onSelectBars?.({
                          barIndex: bar.barIndex,
                          sectionId: bar.sectionId,
                        });'

echo
echo "browser probes: $pass red, $fail vacuous"

# Leave the tree built and served from the real source again.
npm run build >/dev/null 2>&1
restart
