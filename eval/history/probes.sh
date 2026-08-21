#!/usr/bin/env bash
# Vacuity probes for 2K-A.
#
# Each one breaks a guarantee the history makes and asserts that a named check
# actually goes red. A probe that stays green is not good news: it means the
# check is looking somewhere the guarantee is not.
#
# Nine run against the unit suite. Ten need the real browser, because what they
# guard — which surface owns the history, whether a keystroke reached a text
# field, whether the transport came back on — is invisible from a unit test.
set -u

pass=0; fail=0
probe() {
  local name="$1" file="$2" find="$3" repl="$4" cmd="$5"
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

U="npx vitest run src/lib/song/edit-history.test.ts src/lib/song/history-store.test.ts src/lib/song/history-boundary.test.ts"

# 1 — a new commit after an undo must not leave the old future behind
probe "1 the redo branch survives a new commit" \
  src/lib/song/edit-history.ts \
  '  const kept = history.snapshots.slice(0, history.cursor + 1);' \
  '  const kept = [...history.snapshots];' \
  "$U"

# 2 — a candidate that changes nothing is not a step
probe "2 a no-op becomes a history step" \
  src/lib/song/song-store.ts \
  '      if (sameSong(next, currentSong(history))) return false;' \
  '' \
  "$U"

# 3 — the schema decides what may enter the history
probe "3 an unparseable song becomes a history step" \
  src/lib/song/song-store.ts \
  '      if (!songSchema.safeParse(next).success) return false;' \
  '' \
  "$U"

# 4 — undo and redo move the cursor; they never add
probe "4 an undo adds an entry instead of moving" \
  src/lib/song/edit-history.ts \
  '  return { snapshots: history.snapshots, cursor: history.cursor - 1 };' \
  '  return recordEdit(history, history.snapshots[history.cursor - 1]!.song, { kind: "note_edit" });' \
  "$U"

# 5 — a redo returns exactly the song that was there
probe "5 a redo lands one step short" \
  src/lib/song/edit-history.ts \
  '  return { snapshots: history.snapshots, cursor: history.cursor + 1 };' \
  '  return history;' \
  "$U"

# 6 — the fifty-step limit is real
probe "6 the history is unbounded" \
  src/lib/song/edit-history.ts \
  '  const maxSnapshots = Math.max(1, limit) + 1;' \
  '  const maxSnapshots = Number.MAX_SAFE_INTEGER;' \
  "$U"

# 7 — a snapshot is never rewritten in place
probe "7 recording mutates the list it was given" \
  src/lib/song/edit-history.ts \
  '  const kept = history.snapshots.slice(0, history.cursor + 1);
  const snapshots = [...kept, { song, actionFromPrevious: action }];' \
  '  const snapshots = history.snapshots as HistorySnapshot[];
  snapshots.length = history.cursor + 1;
  snapshots.push({ song, actionFromPrevious: action });' \
  "$U"

# 8 — a baseline is where undoing stops
probe "8 replacing the baseline keeps the old history" \
  src/lib/song/song-store.ts \
  '      history = resetEditHistory(song);' \
  '      history = recordEdit(history, song, { kind: "note_edit" });' \
  "$U"

# 9 — no component may own a second history
probe "9 a component keeps its own undo stack" \
  src/components/workspace/Workspace.tsx \
  '  const [editing, setEditing] = useState(false);' \
  '  const [editing, setEditing] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  void undoStack;
  void setUndoStack;' \
  "$U"

echo
echo "unit probes: $pass red, $fail vacuous"
