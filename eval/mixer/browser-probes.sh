#!/usr/bin/env bash
# 2L-C vacuity probes that need the real browser (spec 13.18 §16).
#
# Eight mutations against behaviour only a running page can show: a mixer
# that commits when it opens, a slider that commits, an apply that commits
# twice, a mix change that rebuilds the engine, a new song that keeps the
# audition, a preview that drops it, an undo that rewinds it, and a section
# form that quietly loses 3/4 and 7/8. Each rebuilds with the demo flag the
# acceptance suite documents and asserts the acceptance run goes red.
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
    if ONE_VIEWPORT=1 node eval/mixer/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 21 — merely opening the mixer writes to the song
probe "21 opening the mixer commits the draft" \
  src/lib/workspace/use-mixer.ts \
  '  const begin = useCallback(() => {
    setOpenedSong(song);' \
  '  const begin = useCallback(() => {
    commit({ ...song, title: `${song.title} ` }, { kind: "track_mix_update" });
    setOpenedSong(song);'

# 22 — the staged draft stops being a draft: every slider move commits
probe "22 every slider move commits" \
  src/lib/workspace/use-mixer.ts \
  '        audio.previewMix(trackId, next.volumeDb, next.pan);' \
  '        audio.previewMix(trackId, next.volumeDb, next.pan);
        commit({ ...song, title: `${song.title} ` }, { kind: "track_mix_update" });'

# 23 — one apply, two writes and two history steps
probe "23 one apply commits more than once" \
  src/lib/workspace/use-mixer.ts \
  '    if (sameSong(result.song, song)) return true;
    return commit(result.song, { kind: "track_mix_update" });' \
  '    if (sameSong(result.song, song)) return true;
    commit(
      { ...result.song, title: `${result.song.title} ` },
      { kind: "track_mix_update" },
    );
    return commit(result.song, { kind: "track_mix_update" });'

# 24 — a mix commit rebuilds the engine and re-decodes every sample
probe "24 a mix commit rebuilds the engine" \
  src/lib/audio/use-playback.ts \
  '    if (isMixOnlyChange(entry.song, song)) {' \
  '    if ((false as boolean) && isMixOnlyChange(entry.song, song)) {'

# 25 — a new song, or an opened project, keeps the old audition
probe "25 a new song keeps the audition" \
  src/components/workspace/Workspace.tsx \
  '    // Different music: nothing carried over about who was being listened to.
    clearAudition();' \
  '    void clearAudition;'

# 26 — merely previewing an import puts the audition down
probe "26 an import preview clears the audition" \
  src/lib/project/use-project-file.ts \
  '        setState({
          status: "preview",' \
  '        onBeforeApply();
        setState({
          status: "preview",'

# 27 — undo rewinds how someone was listening, as if it were an edit
probe "27 undo rewinds the audition" \
  src/components/workspace/Workspace.tsx \
  '    if (!canUndo) return;
    pause();' \
  '    if (!canUndo) return;
    clearAudition();
    pause();'

# 28 — the odd meters quietly disappear from the section form again
probe "28 3/4 and 7/8 leave the section form" \
  src/components/workspace/SectionManagerSheet.tsx \
  '              {TIME_SIGNATURES.map((entry, index) => (' \
  '              {TIME_SIGNATURES.map((entry, index) => entry[0] === 3 || entry[0] === 7 ? null : ('

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
