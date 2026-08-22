#!/usr/bin/env bash
# Vacuity probes for 2K-B.
#
# Recovery code only runs when something has already gone wrong, so its tests
# are the easiest in the codebase to write vacuously: a check that never
# reaches the branch it names looks exactly like a check that passes. Each
# probe below breaks one guarantee and asserts a named test actually goes red.
#
# Thirteen run against the unit suite. Six need the real browser, because what
# they guard — a reload, a quota error, a disabled control — has no meaning
# without one.
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

U="npx vitest run src/lib/song/storage-envelope.test.ts src/lib/song/durable-save.test.ts src/lib/song/storage-boundary.test.ts src/lib/song/storage.test.ts"

# 1 — a song from before the envelope must still open
probe "1 a legacy song is no longer read" \
  src/lib/song/storage-envelope.ts \
  '  const legacy = songSchema.safeParse(parsed);
  if (legacy.success) return { kind: "legacy", song: legacy.data };' \
  '' \
  "$U"

# 2 — migrating must not drop the song it replaces
probe "2 migration throws the legacy song away" \
  src/lib/song/storage-envelope.ts \
  '      : onDisk.kind === "legacy"
        ? onDisk.song' \
  '      : onDisk.kind === "legacy"
        ? null' \
  "$U"

# 3 — the previous slot is what a broken current slot is for
probe "3 previous is never tried" \
  src/lib/song/storage-envelope.ts \
  '  if (previous.success) {
    return {
      kind: "recovered_previous",
      song: previous.data,
      revision: shell.data.revision,
    };
  }' \
  '' \
  "$U"

# 4 — an unreadable file is the musician'"'"'s, and is kept
probe "4 a total loss is not quarantined" \
  src/lib/song/storage.ts \
  '      const backupKey = raw === null ? undefined : quarantine(storage, raw, now, true);' \
  '      const backupKey: string | undefined = undefined;' \
  "$U"

# 5 — a newer version is not corrupt
probe "5 a future version is treated as corrupt" \
  src/lib/song/storage-envelope.ts \
  '  const tag = envelopeTagSchema.safeParse(parsed);
  if (tag.success && tag.data.version !== SONG_ENVELOPE_VERSION) {
    return { kind: "unsupported_version", version: tag.data.version };
  }' \
  '' \
  "$U"

# 6 — nothing moves until the write has landed
probe "6 the commit changes memory before storage" \
  src/lib/song/song-store.ts \
  '    if (!saved.ok && saved.reason !== "unavailable") {' \
  '    history = next;
    if (!saved.ok && saved.reason !== "unavailable") {' \
  "$U"

# 7 — a quota error is not success
probe "7 a refused write reports success" \
  src/lib/song/storage.ts \
  '  if (!writeEnvelope(storage, envelope)) {
    return { ok: false, reason: "write_failed" };
  }' \
  '  writeEnvelope(storage, envelope);' \
  "$U"

# 8 — a failed write must not advance the cursor
probe "8 a failed write advances the history" \
  src/lib/song/song-store.ts \
  '      publish();
      return false;
    }' \
  '      history = next;
      publish();
      return false;
    }' \
  "$U"

# 9 — an undo is one write, not two
probe "9 an undo writes twice" \
  src/lib/song/song-store.ts \
  '    const saved = storage === undefined ? saveSong(song) : saveSong(song, storage);' \
  '    if (storage !== undefined) saveSong(song, storage);
    const saved = storage === undefined ? saveSong(song) : saveSong(song, storage);' \
  "$U"

# 10 — previous is the song that was on disk, not something else
probe "10 previous keeps the wrong song" \
  src/lib/song/storage-envelope.ts \
  '  const previous =
    onDisk.kind === "envelope"
      ? onDisk.song' \
  '  const previous =
    onDisk.kind === "envelope"
      ? song' \
  "$U"

# 11 — the revision only counts up
probe "11 the revision is not monotonic" \
  src/lib/song/storage-envelope.ts \
  '      ? onDisk.revision + 1' \
  '      ? 1' \
  "$U"

# 12 — a recovered song is where the session starts, not a step in it
probe "12 recovery leaves an undo behind it" \
  src/lib/song/song-store.ts \
  '  let history: EditHistory = createEditHistory(initial.song);' \
  '  let history: EditHistory = recordEdit(
    createEditHistory(initial.song),
    { ...initial.song, title: `${initial.song.title} ` },
    { kind: "note_edit" },
  );' \
  "$U"

# 13 — storage decisions stay out of components
#
# Tried against the browser run first, where it came back green: a component
# reading a key it is not supposed to read changes nothing a reader can see.
# The guarantee is about the wiring, so it belongs with the test that reads
# the wiring off disk.
probe "13 a component reads storage directly" \
  src/components/workspace/RecoveryBanner.tsx \
  '  const canDismiss = state !== "unsupported_version";' \
  '  const canDismiss =
    state !== "unsupported_version" &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("aranje.song") !== null;' \
  "$U"

echo
echo "unit probes: $pass red, $fail vacuous"
