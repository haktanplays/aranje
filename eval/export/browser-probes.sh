#!/usr/bin/env bash
# 2M-A vacuity probes that need the real browser (spec 13.19 §18).
#
# Six mutations against behaviour only a running page can show: an export that
# writes to storage, one that makes a history step, a URL that is never
# revoked, a failure that re-offers the previous file, a persist gate that
# blocks exporting, and a missing attribution. Each rebuilds with the demo
# flag the acceptance suite documents and asserts the run goes red.
set -u

pass=0; fail=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
}

probe() {
  local name="$1" file="$2" find="$3" repl="$4"
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

  if (rm -rf .next && NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true npm run build) >/dev/null 2>&1; then
    restart
    if ONE_VIEWPORT=1 node eval/export/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) senaryo)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 29 — exporting writes the song back to storage
probe "29 an export writes to storage" \
  src/lib/workspace/use-export.ts \
  '      const result = exportProject(song);' \
  '      window.localStorage.setItem("aranje.song", JSON.stringify(song));
      const result = exportProject(song);'

# 30 — exporting makes a history step out of a read
probe "30 an export makes a history step" \
  src/components/workspace/Workspace.tsx \
  '  const exporter = useExport({
    song,
    audibleTrackIds: mixer.audibleTrackIds,
    pausePlayback: pause,
  });' \
  '  const exporter = useExport({
    song,
    audibleTrackIds: mixer.audibleTrackIds,
    pausePlayback: () => {
      pause();
      commit({ ...song, title: `${song.title} ` }, { kind: "track_mix_update" });
    },
  });'

# 31 — the previous file's URL is left alive for the browser to hold
probe "31 the Object URL is never revoked" \
  src/lib/workspace/use-export.ts \
  '  const revoke = useCallback(() => {
    if (currentUrl.current !== null) {
      URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = null;
    }
  }, []);' \
  '  const revoke = useCallback(() => {
    currentUrl.current = null;
  }, []);'

# 32 — a failed export leaves last time's audio on the download button
probe "32 a failed export re-offers the stale file" \
  src/lib/workspace/use-export.ts \
  '      revoke();
      setReady(null);
      setStatusText(null);
      setError(EXPORT_MESSAGES[code]);
      setPhase("error");' \
  '      setStatusText(null);
      setError(EXPORT_MESSAGES[code]);
      setPhase("error");'

# 33 — a session that cannot save is also refused its files
probe "33 canPersist false blocks exporting" \
  src/components/workspace/ExportSheet.tsx \
  '          <SheetButton
            data-export-project
            disabled={busy}' \
  '          <SheetButton
            data-export-project
            disabled={busy || !canPersist}'

# 34 — the attribution the licence requires quietly disappears
probe "34 the attribution is removed from the surface" \
  src/lib/export/attribution.ts \
  'export function attributionLine(): string {
  return SAMPLE_LICENSE.attribution;
}' \
  'export function attributionLine(): string {
  return "";
}'

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
