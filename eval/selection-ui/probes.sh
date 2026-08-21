#!/usr/bin/env bash
# Vacuity probes for 2I-B.
#
# Each probe breaks one guarantee and asserts that a named test actually goes
# red. A test that stays green is testing nothing, and this is the only way to
# find that out.
#
# Six run against the unit suite; four need the real browser, because what they
# guard — writes, undo steps, a second scroller — is not visible from a unit
# test at all.
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

U="npx vitest run"

# 1 — a scroll must never arm the press
probe "1 scroll starts a selection" \
  src/lib/ui/long-press-machine.ts \
  '  if (dx >= LONG_PRESS_MOVE_TOLERANCE_PX || dy >= LONG_PRESS_MOVE_TOLERANCE_PX) {' \
  '  if (false) {' \
  "$U src/lib/ui/long-press-machine.test.ts"

# 4 — a chord is one group, not one note
probe "4 chord selected as a single note" \
  src/lib/song/transform.ts \
  '      notes: notesOf(entry).map((note) => ({ ...note })),' \
  '      notes: notesOf(entry).slice(0, 1).map((note) => ({ ...note })),' \
  "$U src/lib/song/transform.test.ts"

# 5 — mixed-grid coordinates must come from ticks
probe "5 band positioned from slot index" \
  src/components/workspace/selection-geometry.ts \
  '    const into = (ticks - span.startTicks) / span.durationTicks;' \
  '    const into = (ticks / 96) / (span.durationTicks / 96) / 4;' \
  "$U src/components/workspace/selection-geometry.test.ts"

# 3 — a refused transform must not reach storage
probe "3 failed transform still commits" \
  src/lib/song/transform.ts \
  '  if (result.ok) store.commit(result.song);' \
  '  store.commit(result.ok ? result.song : { ...store.getSnapshot().song });' \
  "$U src/lib/song/transform.test.ts"

# 7 — the core has exactly one caller
probe "7 component bypasses the core" \
  src/components/workspace/SelectionActionBar.tsx \
  'import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";' \
  'import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { applyTransform } from "@/lib/song/transform";
void applyTransform;' \
  "$U src/lib/song/transform-boundary.test.ts"

# 9 — no diagnostic may reach the reader
probe "9 diagnostic leaks into a message" \
  src/lib/song/transform-messages.ts \
  '  target_occupied: "Hedefte zaten nota veya uzayan bir ses var.",' \
  '  target_occupied: "target_occupied: ZodError at schema.ts",' \
  "$U src/lib/song/selection-summary.test.ts"

echo
echo "unit probes: $pass red, $fail vacuous"
