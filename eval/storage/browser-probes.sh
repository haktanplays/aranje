#!/usr/bin/env bash
# Vacuity probes that need the real browser.
#
# Six guarantees no unit test can see: what survives a reload, what a ghost
# leaves on disk, whether a quota error reaches the screen honestly, whether a
# file from a newer version really locks the controls, and whether a technical
# word can escape into a banner.
#
# A seventh started here and moved out. "A component reads storage directly"
# came back green: the mutation changed nothing a *reader* could see, because
# the rule it breaks is a rule about the wiring, and the wiring is checked by
# a unit test. A probe belongs with the suite that owns its guarantee.
set -u

pass=0; fail=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
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
    if node eval/storage/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 13 — a ghost is never written
probe "13 the ghost is written on the way out" \
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

# 14 — the history is session-only and never reaches the file
probe "14 the history is written into the envelope" \
  src/lib/song/storage-envelope.ts \
  '  return {
    format: SONG_ENVELOPE_FORMAT,
    version: SONG_ENVELOPE_VERSION,
    revision,
    current: song,
    previous,
  };' \
  '  return {
    format: SONG_ENVELOPE_FORMAT,
    version: SONG_ENVELOPE_VERSION,
    revision,
    current: song,
    previous,
    // A history smuggled into the file: the strict shell must refuse it back.
    snapshots: [song],
  } as SongStorageEnvelopeV1;'

# 15 — the practice setting is not the song's to clear
probe "15 a recovery clears the practice settings" \
  src/lib/song/storage.ts \
  '    storage.setItem(backupKey, raw);
    if (clear) storage.removeItem(SONG_KEY);' \
  '    storage.setItem(backupKey, raw);
    storage.removeItem("aranje.settings");
    if (clear) storage.removeItem(SONG_KEY);'

# 16 — a diagnostic must never reach a musician
probe "16 a technical diagnostic leaks into the banner" \
  src/lib/song/storage.ts \
  '  corrupt_fallback:
    "Kaydedilmiş şarkı açılamadı. Bozuk veri korundu ve örnek şarkı açıldı.",' \
  '  corrupt_fallback:
    "Kaydedilmis sarki acilamadi: JSON schema parse error at sections[0].",'

# 17 — the dismiss control stays a real target
probe "17 the banner target shrinks below a touch target" \
  src/components/workspace/RecoveryBanner.tsx \
  '          style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
        >
          <span aria-hidden>&#10005;</span>' \
  '          style={{ minHeight: 28, minWidth: 28 }}
        >
          <span aria-hidden>&#10005;</span>'

# 18 — a file from a newer version locks editing
probe "18 a newer version still allows editing" \
  src/components/workspace/Workspace.tsx \
  '  const canEdit =
    track !== undefined && isEditableTrack(track) && !previewOpen && canPersist;' \
  '  const canEdit = track !== undefined && isEditableTrack(track) && !previewOpen;'

echo
echo "browser probes: $pass red, $fail vacuous"

npm run build >/dev/null 2>&1
restart
