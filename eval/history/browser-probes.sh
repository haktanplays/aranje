#!/usr/bin/env bash
# Vacuity probes that need the real browser.
#
# Ten guarantees no unit test can see: whether the two surfaces share a
# history, whether a ghost or a copy left a step behind, whether the transport
# came back on by itself, whether a keystroke inside a text field reached the
# song. Each breaks the guarantee, rebuilds, and asserts the acceptance run
# goes red.
#
# Slow on purpose: a production build per probe, because the acceptance run is
# against the production build.
set -u

pass=0; fail=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1
  sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &)
  sleep 6
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
    if node eval/history/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"
      pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 10 — a ghost is a reading, not a step
probe "10 the ghost commits what it is showing" \
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
      if (ghost.ok) {
        store.commit(ghost.song, {
          kind: "bar_transform",
          command: command.kind,
          scope: selection.scope,
        });
      }
    },
    [selection, store],
  );'

# 11 — copying is a reading too
probe "11 copying becomes a history step" \
  src/lib/song/use-bar-transform.ts \
  '    setClipboard(result.clipboard);
    setSelection(result.selection);' \
  '    setClipboard(result.clipboard);
    store.commit(
      { ...store.getSnapshot().song, title: `${store.getSnapshot().song.title} ` },
      { kind: "bar_transform", command: "copy_bars", scope: selection.scope },
    );
    setSelection(result.selection);'

# 12 — a bar command must not bypass the gate
probe "12 a bar transform writes storage itself" \
  src/lib/song/use-bar-transform.ts \
  '      store.commit(result.song, {
        kind: "bar_transform",
        command: command.kind,
        scope: selection.scope,
      });' \
  '      try {
        window.localStorage.setItem("aranje.song", JSON.stringify(result.song));
      } catch {
        /* probe */
      }'

# 13 — undo has to put the editing surfaces down
probe "13 undo leaves the selection on screen" \
  src/components/workspace/Workspace.tsx \
  '    transform.clear();
    barTransform.clear();
    setSheet(null);
    setBarSheet(null);' \
  '    setSheet(null);
    setBarSheet(null);'

# 14 — what the reader is told an undo would reverse
#
# First aimed at removing the `pause()` before an undo, which came back green —
# and that is a finding rather than a bad probe: a song change replaces the
# controller, so the transport stops either way and no check can tell the two
# apart. The pause stays as a statement of intent. What *is* load-bearing and
# unprobed is the other promise on that control: the words on it come from the
# one table, and a raw enum never reaches a musician.
probe "14 the undo control shows a raw command name" \
  src/lib/song/history-labels.ts \
  '    case "bar_transform":
      return action.scope === "full"
        ? FULL_BAR_LABELS[action.command]
        : TRACK_BAR_LABELS[action.command];' \
  '    case "bar_transform":
      return action.command;'

# 15 — a loop that is still real keeps running
probe "15 the loop is dropped on every edit" \
  src/lib/audio/use-playback.ts \
  '    if (loopSectionId !== null && stillThere) next.setLoopSection(loopSectionId);' \
  ''

# 16 — a position survives a change to the structure
#
# The scenario behind this one used to accept any bar of the section the edit
# was in — and bar one of that section is exactly where a transport that lost
# its place would be. It now asserts the clamp itself.
probe "16 the playhead is thrown back to the start" \
  src/lib/audio/use-playback.ts \
  '    if (at !== null) next.seekToNearestBar(at);' \
  ''

# 17 — a shortcut inside a text field belongs to the field
probe "17 the shortcut fires while typing" \
  src/lib/ui/use-edit-shortcuts.ts \
  '      if (isTextEntry(event.target)) return;' \
  ''

# 18 — both spellings of redo
probe "18 only one spelling of redo works" \
  src/lib/ui/use-edit-shortcuts.ts \
  '      const wantsRedo = (key === "z" && event.shiftKey) || key === "y";' \
  '      const wantsRedo = key === "z" && event.shiftKey;'

# 19 — the controls stay reachable
probe "19 the history controls shrink below a touch target" \
  src/components/workspace/EditToolbar.tsx \
  '          style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
        >
          <span aria-hidden>&#8630;</span>' \
  '          style={{ minHeight: 30, minWidth: 30 }}
        >
          <span aria-hidden>&#8630;</span>'

echo
echo "browser probes: $pass red, $fail vacuous"

npm run build >/dev/null 2>&1
restart
