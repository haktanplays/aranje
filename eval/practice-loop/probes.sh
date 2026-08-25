#!/usr/bin/env bash
# Vacuity probes for the practice loop and the windowed kit grid (2R-A §19).
#
# Each probe puts back a way one of this checkpoint's guarantees could be
# quietly untrue — a grid that answers with the wrong section, a harness that
# measures the same section four times, a count-in nothing cancels, a loop that
# leaks into the project file — and asserts that a named test really goes red.
#
# The mutation is always the *dangerous behaviour*, never a syntax error: a
# probe that only breaks compilation proves nothing about the test.
#
#   ./eval/practice-loop/probes.sh
set -u

pass=0; fail=0; skipped=0

# probe <name> <file> <command> <find1> <repl1> [<find2> <repl2> ...]
probe() {
  local name="$1" file="$2" cmd="$3"; shift 3
  # A leftover backup means another probe run is touching this file. Two runs
  # racing over one source silently restore each other's mutation and can
  # leave a real edit behind, so this refuses rather than guesses.
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

  if eval "$cmd" >/dev/null 2>&1; then
    echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
  else
    echo "RED   $name"; pass=$((pass+1))
  fi
  mv "$file.probebak" "$file"
}

V="npx vitest run"
API="$V src/lib/tab/drum-step-api.test.ts"

echo "--- the kit grid is asked for by name (§2) ---"

probe "1 the builder reads the two ids the other way round" \
  src/lib/tab/drum-step-model.ts "$API" \
  '  const section = song.sections.find((entry) => entry.id === sectionId);' \
  '  const section = song.sections.find((entry) => entry.id === trackId);' \
  '  if (!song.tracks.some((track) => track.id === trackId)) return null;' \
  '  if (!song.tracks.some((track) => track.id === sectionId)) return null;'

probe "2 an unknown section falls back to the first one again" \
  src/lib/tab/drum-step-model.ts "$API" \
  '  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section) return null;' \
  '  const section =
    song.sections.find((entry) => entry.id === sectionId) ?? song.sections[0];
  if (!section) return null;'

probe "3 the overscan harness measures every fixture on section one" \
  eval/practice-loop/measure-overscan.ts "$API" \
  '    const model = buildDrumStepModel({ song, sectionId: section.id, trackId });' \
  '    const model = buildDrumStepModel({
      song,
      sectionId: song.sections[0]?.id ?? section.id,
      trackId,
    });'

echo
echo "$pass red, $fail vacuous, $skipped skipped"
exit $(( fail > 0 ? 1 : 0 ))
