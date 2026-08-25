#!/usr/bin/env bash
# 2Q-B vacuity probes that need the real browser (§17).
#
# Six mutations against guarantees no unit test can hold, because they are
# facts about layout and gesture rather than about data: the whole transport
# staying reachable at 320px *and* at the reader's larger text settings, a
# step grid that a reader can actually open, a tap that means one thing, and
# a fretless track that is honest about having no sound. Each breaks a
# guarantee, rebuilds, and asserts that the named acceptance scenarios go red.
#
# Two of these (T1, T2) came from `eval/multitrack/browser-probes.sh` at this
# checkpoint. The rule is unchanged; the surface grew, because the row now
# has to survive 125% and 150% text and those runs only exist here.
#
# The unit-suite probes live in probes.sh.
#
#   ./eval/chord-audio/serve.sh   # once, for the clean baseline
#   ./eval/cross-instrument/browser-probes.sh
set -u

pass=0; fail=0; skipped=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
}

# probe <name> <file> <scenarios> <one-viewport> <find> <repl>
probe() {
  local name="$1" file="$2" only="$3" one="$4" find="$5" repl="$6"
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
  if [ $? -ne 0 ]; then
    echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"
    skipped=$((skipped+1)); return
  fi

  if npm run build >/dev/null 2>&1; then
    restart
    if ONLY="$only" ONE_VIEWPORT="$one" node eval/cross-instrument/verify.mjs \
        >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) senaryo)"
      pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

echo "--- transport, büyük yazı dahil (§10) ---"

# T1 — the touch targets go back to scaling with the reader's text setting
#
# This is the mutation that was actually shipped and measured: `min-h-11` is
# 2.75rem, so at 150% every control became 66px and two of them left the
# screen. It is dangerous only in the large-text runs, which is why this probe
# lives here and not in the 2Q-A file.
probe "T1 touch targets scale with the text setting again" \
  src/components/workspace/TransportBar.tsx "D1,D2,D3" "" \
  '      style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
      className={`flex items-center justify-center rounded-lg border text-sm disabled:opacity-40 ${' \
  '      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-sm disabled:opacity-40 ${'

# T2 — the row is made to fit by scrolling instead of by fitting
probe "T2 the transport row hides its overflow behind a scroller" \
  src/components/workspace/TransportBar.tsx "D1,D3,D7" "" \
  '        className="flex flex-wrap items-center py-1.5"' \
  '        className="flex items-center overflow-x-auto py-1.5"'

echo "--- yazma yüzeyine erişim (§5.3) ---"

# T3 — the edit gate closes again on the instruments this checkpoint opened.
# The surfaces still exist; nobody can reach them. This is the defect the
# acceptance run found on the first pass.
probe "T3 only fretted tracks may be edited again" \
  src/lib/workspace/edit-gate.ts "A4,A6,A7,B3" "1" \
  '  const canEdit = track !== undefined && !previewOpen && canPersist;' \
  '  const canEdit =
    track !== undefined &&
    track.fretboard !== undefined &&
    !previewOpen &&
    canPersist;'

# T4 — the new track is made and the reader is left somewhere else
probe "T4 creating a track leaves the reader on the previous one" \
  src/lib/workspace/use-lifecycle.ts "A3,A7" "1" \
  '          const made = createdTrackId(song, next);
          if (made !== null) {
            selectTrack(made);
            return;
          }' \
  ''

echo "--- dokunuşun anlamı ve dürüst sessizlik (§5, §7) ---"

# T5 — a tap always writes, so a second tap on a filled cell writes again
probe "T5 a tap on a filled cell writes instead of erasing" \
  src/lib/workspace/use-event-entry.ts "A8,A9" "1" \
  '      if (hitAt(song, target, piece)) eraseDrumHit(target, piece);
      else writeDrumHit(target, piece, level);' \
  '      writeDrumHit(target, piece, level);'

# T6 — a track with no sample offers a preview anyway
probe "T6 a silent instrument offers Dinle as if it could sound" \
  src/lib/workspace/use-event-entry.ts "B8,B9" "1" \
  '      audible: isPlayablePreset(track.instrumentId, track.presetId),' \
  '      audible: true,'

echo
echo "kırmızı $pass · vacuous $fail · atlanan $skipped"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
