#!/usr/bin/env bash
# Vacuity probes for 2J.
#
# Each probe breaks one guarantee and asserts that a named test actually goes
# red. A test that stays green is testing nothing, and this is the only way to
# find that out.
#
# Six run against the unit suite. Six need the real browser, because what they
# guard — which engine is running, which scroller is live, what a tap seeks to
# — is not visible from a unit test at all.
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

U="npx vitest run src/lib/arrangement"

# 1 — the grid must not reach the width
probe "1 resolution changes bar width" \
  src/lib/arrangement/geometry.ts \
  '  return Math.round(barWholeNotes(timeSignature, resolution) * PX_PER_WHOLE);' \
  '  return Math.round(barWholeNotes(timeSignature, resolution) * PX_PER_WHOLE * (resolution / 8));' \
  "$U"

# 2 — nor may the tempo
probe "2 tempo changes pixel width" \
  src/lib/arrangement/model.ts \
  '      const width = arrangementBarWidth(bar.timeSignature, bar.resolution);' \
  '      const width = Math.round(arrangementBarWidth(bar.timeSignature, bar.resolution) * (song.bpm / 120));' \
  "$U"

# 3 — silence is not a repeat of silence
probe "3 a silent bar counts as a repeat" \
  src/lib/arrangement/digest.ts \
  '  if (isSilentCell(bar, trackId)) return null;' \
  '  if (isSilentCell(bar, trackId)) return "silent";' \
  "$U"

# 4 — how hard a note is hit is part of the bar
probe "4 velocity dropped from the digest" \
  src/lib/arrangement/digest.ts \
  '        note.velocity ?? "null",
        note.articulation ?? "null",' \
  '        note.articulation ?? "null",' \
  "$U"

# 5 — a section seam is not a rest
probe "5 tie cut at a section boundary" \
  src/lib/arrangement/links.ts \
  '    if (bar.spans.some((span) => span.openEnd)) add(bar.key, next.key, "tie");' \
  '    if (bar.sectionId !== next.sectionId) return;
    if (bar.spans.some((span) => span.openEnd)) add(bar.key, next.key, "tie");' \
  "$U"

# 6 — but a bar the track is not written in *is* silence
probe "6 missing track key does not cut the carry" \
  src/lib/tab/timeline.ts \
  '    const continues = nextSlots !== undefined && nextSlots[0] === "-";' \
  '    const continues = nextSlots === undefined || nextSlots[0] === "-";' \
  "$U"

echo
echo "unit probes: $pass red, $fail vacuous"

# ---------------------------------------------------------------- browser
#
#   bash eval/arrangement/probes.sh --browser
#
if [ "${1:-}" = "--browser" ]; then
  bprobe() {
    local name="$1" file="$2" find="$3" repl="$4" test_name="$5"
    cp "$file" "$file.probebak"
    python3 - "$file" "$find" "$repl" <<'PY'
import io,sys
p,f,r=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding="utf-8").read()
if f not in s:
    sys.stderr.write("ANCHOR MISSING\n"); sys.exit(2)
io.open(p,"w",encoding="utf-8").write(s.replace(f,r,1))
PY
    if [ $? -ne 0 ]; then echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"; return; fi

    if ! npm run build >/dev/null 2>&1; then
      # A mutation that will not compile proves nothing about the check. Say so
      # rather than serving the previous build and calling the result a pass.
      echo "BROKEN $name  <-- the mutation does not build"
      mv "$file.probebak" "$file"; return
    fi
    # The bracket is not cosmetic: a plain pattern matches the shell running
    # this very line, so the probe would kill its own parent.
    pkill -f '[n]ext-server' 2>/dev/null || true
    sleep 1
    (npx next start -p 3100 >/dev/null 2>&1 &)
    until curl -s -m 2 -o /dev/null http://127.0.0.1:3100/; do sleep 1; done

    ARRANGEMENT_OUT=/tmp/arr-probe-artifacts \
      timeout 900 node eval/arrangement/verify.mjs > /tmp/arr-probe-out.txt 2>&1

    # "The named check did not fail" is not "the check passed": a mutation can
    # take the run down before the check ever runs. Noticed anywhere counts,
    # and where it was noticed is worth printing rather than requiring.
    if grep -q "^FAIL.*${test_name}" /tmp/arr-probe-out.txt; then
      echo "RED   $name"
    elif grep -q "^FAIL" /tmp/arr-probe-out.txt; then
      caught=$(grep -m1 "^FAIL" /tmp/arr-probe-out.txt | sed 's/^FAIL *//' | cut -c1-56)
      echo "RED   $name  (caught by: $caught)"
    elif ! grep -q "${test_name}" /tmp/arr-probe-out.txt; then
      echo "BROKEN $name  <-- the run never reached any check"
    else
      echo "GREEN $name  <-- VACUOUS"
    fi
    mv "$file.probebak" "$file"
  }

  mkdir -p /tmp/arr-probe-artifacts

  # 7 — a bar tap has to land on that bar's own tick
  bprobe "7 bar tap seeks to the wrong tick" \
    src/components/workspace/Workspace.tsx \
    '      seekToBar(barKey);
      setPendingTabBar(barKey);' \
    '      seekToBar(`${song.sections[0]?.id}:0`);
      setPendingTabBar(barKey);' \
    "22 the tap seeks to that bar"

  # 8 — switching surfaces is a view change, not an audio event
  bprobe "8 the view switch rebuilds the engine" \
    src/components/workspace/Workspace.tsx \
    '        {view === "arrange" ? (
          <ArrangementCanvas' \
    '        {view === "arrange" ? (
          <ArrangementCanvas key={String(Math.random())}' \
    "20 no second engine is built"

  # 9 — exactly one live horizontal scroller per surface
  #
  # The first version of this probe replaced the view ternary with `true`, which
  # does not compile: the tab branch relies on that condition for narrowing, so
  # the build failed for a reason that has nothing to do with scrollers. This
  # one adds a real second scroller instead — eight of them, one per lane.
  bprobe "9 a second horizontal scroller appears" \
    src/components/workspace/ArrangementCanvas.tsx \
    'className="border-line absolute right-0 left-0 flex border-b"' \
    'className="border-line absolute right-0 left-0 flex w-40 overflow-x-auto border-b"' \
    "33 one horizontal scroller"

  # 10 — a track name is a view choice, never a write
  bprobe "10 tapping a track name writes" \
    src/components/workspace/ArrangementCanvas.tsx \
    '                onClick={() => onSelectTrack(track.trackId)}' \
    '                onClick={() => { try { localStorage.setItem("aranje.song", localStorage.getItem("aranje.song") ?? ""); } catch { /* probe */ } onSelectTrack(track.trackId); }}' \
    "26 tapping a track name writes nothing"

  # 11 — a staged command is dropped by a view change, never committed
  bprobe "11 a pending transform commits on a view change" \
    src/components/workspace/Workspace.tsx \
    '  const enterArrange = useCallback(() => {
    transform.clear();' \
    '  const enterArrange = useCallback(() => {
    transform.apply();
    transform.clear();' \
    "29 the staged move is dropped, not committed"

  # 12 — the narrow screen has to hold
  bprobe "12 the body overflows at 320px" \
    src/lib/arrangement/geometry.ts \
    'export const TRACK_LABEL_WIDTH = 96;' \
    'export const TRACK_LABEL_WIDTH = 900;' \
    "32 no body overflow"

  npm run build >/dev/null 2>&1
fi
