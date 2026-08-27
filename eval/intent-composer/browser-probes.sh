#!/usr/bin/env bash
# 2S-A vacuity probes that need a real browser (§17).
#
# Twelve mutations against guarantees no node test can hold, because each is a
# fact about the page rather than about data: a hit target that shrinks with
# the reader's text setting, a row that clips instead of wrapping, a mask that
# does not cut the string, an arc layer that swallows taps, a storage write
# that happens twice. Each one breaks the guarantee, rebuilds the production
# app, runs the named acceptance tour and asserts that it goes red.
#
# The unit and AST probes live in `probes.sh`; the audio ones in
# `audio-probes.sh`.
#
#   ./eval/chord-audio/serve.sh   # once, for the clean baseline
#   ./eval/intent-composer/browser-probes.sh
set -u

pass=0; fail=0; skipped=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
}

# probe <name> <file> <tours> <find1> <repl1> [<find2> <repl2> ...]
probe() {
  local name="$1" file="$2" only="$3"; shift 3
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

  if npm run build >/dev/null 2>&1; then
    restart
    if ONLY="$only" node eval/intent-composer/verify.mjs \
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

# The same mutation harness, run against the technique-notation acceptance
# instead of the 2S-A tour (Technique Notation Grammar v1 §11).
techprobe() {
  local name="$1" file="$2"; shift 2
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
  if npm run build >/dev/null 2>&1; then
    restart
    if node eval/intent-composer/technique-visual.mjs \
        >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) ekran)"
      pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# The same mutation harness against the K-59 visual closure run.
k59probe() {
  local name="$1" file="$2"; shift 2
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
  if npm run build >/dev/null 2>&1; then
    restart
    if node eval/intent-composer/k59-visual.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

echo "--- the edit grid is a finger tall (§4, §11) ---"

probe "B1 the edit row shrinks back to the reading row" \
  src/components/workspace/FrettedBarBlock.tsx "glyph" \
  '  const rowHeight = editing ? EDIT_STRING_ROW_HEIGHT : STRING_ROW_HEIGHT;' \
  '  const rowHeight = STRING_ROW_HEIGHT;'

probe "B2 the touch minimum follows the reader's text size" \
  src/components/workspace/geometry.ts "glyph" \
  'export const EDIT_STRING_ROW_HEIGHT = MIN_TOUCH_TARGET_PX;' \
  'export const EDIT_STRING_ROW_HEIGHT = 26;'

echo "--- the fret number is not a card (§4) ---"

probe "B3 the digit takes its padding back" \
  src/components/workspace/FretGlyph.tsx "glyph" \
  '        className={`relative font-mono text-[12px] leading-none tabular-nums ${tone}`}' \
  '        className={`bg-app relative rounded px-[3px] font-mono text-[12px] leading-none tabular-nums ${tone}`}'

probe "B4 the numerals stop lining up in a chord" \
  src/components/workspace/FretGlyph.tsx "glyph" \
  '        className={`relative font-mono text-[12px] leading-none tabular-nums ${tone}`}' \
  '        className={`relative text-[12px] leading-none ${tone}`}'

probe "B5 the digit is painted into the 44px hit target" \
  src/components/workspace/FretGlyph.tsx "glyph" \
  '      className="relative inline-flex items-center justify-center"' \
  '      className="relative inline-flex h-11 w-11 items-center justify-center"'

echo "--- the technique marks are drawn, and touch nothing (TNG §2, §11) ---"

probe "B6 the technique layer swallows the taps meant for the notes" \
  src/components/workspace/TechniqueLayer.tsx "glyph" \
  'pointer-events-none' \
  'pointer-events-auto'

probe "B7 the marks never reach the page" \
  src/components/workspace/TechniqueLayer.tsx "glyph" \
  '  if (primitives.count === 0) return null;' \
  '  if (primitives.count >= 0) return null;'

# The staff's height is `stringCount * rowHeight` and knows nothing about
# annotations, so making the layer an in-flow element cannot grow it — that
# mutation is equivalent, and this asks the real question instead: what if the
# marks were allowed into the measurement at all?
techprobe "B17 the marks are allowed to grow the staff they are drawn over" \
  src/components/workspace/FrettedBarBlock.tsx \
  '      <div className="relative" style={{ height: staffHeight }}>' \
  '      <div className="relative" style={{ height: staffHeight + techniques.count * 4 }}>'

techprobe "B18 a mark is drawn in the accent even when nothing is selected" \
  src/components/workspace/TechniqueLayer.tsx \
  '    preview && slots.some((slot) => preview(stringIndex, slot))
      ? "preview"
      : "read";' \
  '    "preview";'

techprobe "B19 the lane floor goes back to the string line" \
  src/lib/tab/technique-geometry.ts \
  '    bottom: y - Math.max(LANE_CLEAR_PX, DIGIT_HALF_PX + 1),' \
  '    bottom: y - LANE_CLEAR_PX,'

techprobe "B20 a bend may spill past its own note into the next" \
  src/lib/tab/technique-geometry.ts \
  '      Math.min(digits.right, ceiling - BEND_RUN_PX),' \
  '      digits.right + BEND_RUN_PX * 3,'

echo "--- the action row wraps rather than clipping (§5) ---"

probe "B8 the edit row goes back to one fixed line" \
  src/components/workspace/EditToolbar.tsx "layout" \
  '      <div className="flex flex-wrap items-center gap-2">' \
  '      <div className="flex flex-nowrap items-center gap-2 overflow-hidden">'

probe "B9 the toggle is sized in rem again" \
  src/components/workspace/EditToolbar.tsx "layout,glyph" \
  '            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            className={`min-w-0 flex-1 basis-32 rounded-lg border px-3 text-sm font-medium disabled:opacity-40 ${' \
  '            className={`min-h-16 min-w-0 flex-1 basis-32 rounded-lg border px-3 text-base font-medium disabled:opacity-40 ${'

probe "B10 the doors are sized in rem again" \
  src/components/workspace/ComposerDoorRow.tsx "layout" \
  '          className={`min-h-11 min-w-0 flex-1 rounded-lg border px-1.5 text-sm whitespace-nowrap ${' \
  '          className={`min-h-14 min-w-0 flex-1 basis-24 rounded-lg border px-3 text-base ${' \
  '          style={{ minHeight: MIN_TOUCH_TARGET_PX, flexBasis: armed ? 44 : 56 }}' \
  '          style={{}}'

echo "--- the focused edit layout (§18) ---"

# The defect acceptance missed: a row with the right height, off the screen.
probe "B13 the normal chrome stays up while writing" \
  src/components/workspace/Workspace.tsx "glyph" \
  '        editing={noteEditing.editing}' \
  '        editing={false}'

probe "B14 the staff answers a cramped screen with a scroller of its own" \
  src/components/workspace/FrettedBarBlock.tsx "glyph" \
  '      style={{ width }}' \
  '      style={{ width, maxHeight: 120, overflowY: "auto" }}'

probe "B15 six 44px bands are stacked 26px apart" \
  src/components/workspace/geometry.ts "glyph" \
  'export const EDIT_STRING_ROW_HEIGHT = MIN_TOUCH_TARGET_PX;' \
  'export const EDIT_STRING_ROW_HEIGHT = 26;'

probe "B16 the way out of edit mode is not a control" \
  src/components/workspace/EditHeader.tsx "glyph" \
  '        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        Bitti' \
  '        style={{ minHeight: 12 }}
      >
        Bitti'

echo "--- what one gesture writes (§7, §12) ---"

probe "B11 the pen writes the project twice" \
  src/lib/song/song-store.ts "pen" \
  '      ? persistence.save(song)' \
  '      ? (persistence.save(song), persistence.save(song))'

probe "B12 a tap with the pen armed is an ordinary tap again" \
  src/lib/workspace/use-intent-composer.ts "pen" \
  '  if (!composer.penArmed) return noteEditing;' \
  '  return noteEditing;
  if (!composer.penArmed) return noteEditing;'

echo
echo "$pass red, $fail vacuous, $skipped skipped"
exit $(( fail > 0 ? 1 : 0 ))

echo "--- the visual closure holds (K-59 §2-§7) ---"

k59probe "K1 the tall selection bar comes back on top of the compact one" \
  src/components/workspace/SelectionActionArea.tsx \
  '      {time.handle.selection && !compact ? (' \
  '      {time.handle.selection ? ('

k59probe "K2 the doors keep their line while a selection is open" \
  src/components/workspace/EditArea.tsx \
  '            showDoors={selectionActions === null}' \
  '            showDoors'

k59probe "K3 a second way out of edit mode comes back" \
  src/components/workspace/EditToolbar.tsx \
  '  const showToggle = canToggleEdit && !editing;' \
  '  const showToggle = canToggleEdit;'

k59probe "K4 the staff says the section name a second time" \
  src/components/workspace/TabCanvas.tsx \
  'showSectionName={!editing}>' \
  'showSectionName>'

k59probe "K5 the pen previews its root and leaves the rest out" \
  src/lib/tab/pen-ghost.ts \
  '    notes: [...notes].sort((a, b) => a.stringIndex - b.stringIndex),' \
  '    notes: [...notes].sort((a, b) => a.stringIndex - b.stringIndex).slice(0, 1),'

k59probe "K6 the underline comes back under a drawn arc" \
  src/lib/tab/glyph-state.ts \
  '  if (slurred && !request.underArc) return "legato";' \
  '  if (slurred) return "legato";'
