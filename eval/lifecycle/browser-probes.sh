#!/usr/bin/env bash
# 2L-B vacuity probes that need the real browser.
#
# Nine mutations against behaviour only a running page can show: a second
# commit per apply, a backup that writes, a loop that survives its section,
# a destructive change with no confirmation, a delete that applies at the
# preview, a refusal reported as success, a bypassed persist gate, a
# provider call, a second engine. Each rebuilds (with the demo flag the
# acceptance suite documents) and asserts the acceptance run goes red.
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
    if ONE_VIEWPORT=1 node eval/lifecycle/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 17 — one apply becomes two commits, two history steps
probe "17 a new song produces two history steps" \
  src/lib/workspace/use-lifecycle.ts \
  '      ground?.();
      if (!commit(result.song, { kind: "lifecycle", command })) {' \
  '      ground?.();
      commit(
        { ...result.song, title: `${result.song.title} ` },
        { kind: "lifecycle", command },
      );
      if (!commit(result.song, { kind: "lifecycle", command })) {'

# 18 — the backup action writes to storage
probe "18 the backup writes to storage" \
  src/lib/project/use-project-file.ts \
  '    setExportError(null);

    const blob = new Blob([result.text], { type: PROJECT_FILE_MIME });' \
  '    setExportError(null);
    try {
      window.localStorage.setItem("aranje.song", result.text);
    } catch {}

    const blob = new Blob([result.text], { type: PROJECT_FILE_MIME });'

# 19 — the loop survives the section it pointed at
probe "19 the loop stays on a ghost section" \
  src/lib/audio/use-playback.ts \
  '    if (loopSectionId !== null && stillThere) next.setLoopSection(loopSectionId);' \
  '    void stillThere;
    if (loopSectionId !== null) next.setLoopSection(loopSectionId);'

# 20 — the destructive change applies without its confirmation
probe "20 destructive change skips the confirmation" \
  src/components/workspace/TrackManagerSheet.tsx \
  '            onClick={() => {
              setError(null);
              setMode({ kind: "confirmDestructive" });
            }}' \
  '            onClick={() => {
              if (!draft) return;
              handle(
                lifecycle.runTrack({
                  kind: "replace_track_setup_and_clear_content",
                  trackId: selected.id,
                  setup: setupFrom(draft),
                }),
              );
            }}'

# 21 — the delete applies at the preview, before any confirmation
probe "21 the delete preview already writes" \
  src/components/workspace/SectionManagerSheet.tsx \
  '            onClick={() => {
              setError(null);
              setMode({ kind: "confirmDelete" });
            }}' \
  '            onClick={() => {
              setError(null);
              lifecycle.runSection({
                kind: "delete_section",
                sectionId: selected.id,
              });
              setMode({ kind: "confirmDelete" });
            }}'

# 22 — a refusal is reported as a success
probe "22 a failed apply reads as applied" \
  src/lib/workspace/use-lifecycle.ts \
  '      if (!result.ok) {
        return {
          status: "rejected",
          message: LIFECYCLE_MESSAGES[result.error.code],
        };
      }' \
  '      if (!result.ok) {
        void LIFECYCLE_MESSAGES[result.error.code];
        return { status: "applied", warnings: [] };
      }'

# 23 — the persist gate is bypassed on the create button
probe "23 canPersist false is bypassed" \
  src/components/workspace/NewSongSheet.tsx \
  '            onClick={create}
            disabled={!lifecycle.canApply}' \
  '            onClick={create}
            disabled={false}'

# 24 — a lifecycle apply phones the provider
probe "24 a lifecycle apply calls the provider" \
  src/lib/workspace/use-lifecycle.ts \
  '      ground?.();
      if (!commit(result.song, { kind: "lifecycle", command })) {' \
  '      ground?.();
      void fetch("/api/copilot", { method: "POST", body: "{}" }).catch(() => {});
      if (!commit(result.song, { kind: "lifecycle", command })) {'

# 25 — the structural ground builds a second engine
probe "25 a structural apply builds an AudioContext" \
  src/components/workspace/Workspace.tsx \
  '  const prepareForStructuralApply = useCallback(() => {
    pause();' \
  '  const prepareForStructuralApply = useCallback(() => {
    new AudioContext();
    pause();'

echo
echo "RED: $pass  VACUOUS: $fail"
# Leave a demo-flag build serving, as the acceptance suite documents.
(rm -rf .next && NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true npm run build) >/dev/null 2>&1
restart
[ "$fail" -eq 0 ]
