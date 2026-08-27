#!/usr/bin/env bash
# Can this harness fail? Twelve mutations that say it can (K-59.1 §8).
#
# The Android acceptance harness went green on its first clean run, and a
# harness that is green the first time has told you nothing until you have
# seen it go red. Each probe below breaks exactly one guarantee the harness
# claims to hold, rebuilds the production app, runs the harness, and asserts
# that it reports the *named* failure — not merely that it exits non-zero,
# because a build that crashed would do that too.
#
#   ./eval/chord-audio/serve.sh   # once, for the clean baseline
#   ./eval/android/probes.sh
set -u

pass=0; fail=0; skipped=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-android-server.log 2>&1 &); sleep 6
}

# probe <name> <expected-failure-substring> <file> <find1> <repl1> [...]
probe() {
  local name="$1" expect="$2" file="$3"; shift 3
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
    if node eval/android/harness.mjs >/tmp/aranje-android-probe.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    elif grep -qF "$expect" /tmp/aranje-android-probe.log; then
      echo "RED   $name  ($expect)"; pass=$((pass+1))
    else
      echo "WRONG $name  (red, but not for \"$expect\")"
      grep '^FAIL' /tmp/aranje-android-probe.log | head -1
      fail=$((fail+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

CONDUCTOR=src/components/acceptance/AcceptanceConductor.tsx
SESSION=src/lib/acceptance/session.ts
REPORT=src/lib/acceptance/report.ts
WATCH=src/components/acceptance/useAcceptanceWatch.ts
APP=src/components/workspace/Workspace.tsx

# 1 — no way back at all.
probe "A1 back button removed" "back/forward" "$CONDUCTOR" \
  '{step > 0 ? (' '{false ? ('

# 2 — a back that throws away what the reader already answered.
probe "A2 back clears the answers" "answers lost on back" "$CONDUCTOR" \
  '  const back = () => {' \
  '  const back = () => {
    setAnswers((current) => ({ ...current, visual: null }));'

# 3 — a result block missing one of the six techniques.
probe "A3 result drops a technique" "result incomplete" "$REPORT" \
  '`Palm mute: ${listened("palmMute")}`,' '`Palm: ${listened("palmMute")}`,'

# 4 — a copy button that changes its label but copies nothing.
probe "A4 copy button copies nothing" "copy did not reach the clipboard" "$CONDUCTOR" \
  'navigator.clipboard?.writeText(text).catch(() => undefined);' \
  'void text;'

# 5 — the reader's own note never reaching the block they hand over.
probe "A5 note omitted from the result" "result incomplete" "$REPORT" \
  '`User note: ${answers.note.trim() || "—"}`,' '`User note: —`,'

# 6 — the fixture writing to the device instead of its own Map.
probe "A6 fixture writes to localStorage" "reader storage mutated" "$SESSION" \
  '  const storage = createMemoryStorage();' \
  '  const storage = createMemoryStorage();
  if (typeof window !== "undefined") window.localStorage.setItem("aranje.song", "{}");'

# 7 — the guided route advertised in the app the reader normally opens.
probe "A7 route linked from the app" "route linked from the app" "$APP" \
  '    <div className="flex h-dvh flex-col overflow-hidden">' \
  '    <div className="flex h-dvh flex-col overflow-hidden">
      <a href="/eval/android-acceptance" className="sr-only">Android kabul</a>'

# 8 — a control below the touch minimum.
probe "A8 control under the touch minimum" "under 44" "$CONDUCTOR" \
  'style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`w-full rounded-lg border px-3 text-sm font-medium ${' \
  'style={{ minHeight: 30, height: 30 }}
      className={`w-full rounded-lg border px-3 text-sm font-medium ${'

# 9 — a step the reader cannot get past.
probe "A9 a step becomes unreachable" "steps 0,1,2,3,4" "$CONDUCTOR" \
  '<Big testId="transport-next" onClick={next}>' \
  '<Big testId="transport-none" onClick={next}>'

# 10 — the flow remembering where it was, which means it wrote something.
probe "A10 progress survives a refresh" "reader storage mutated" "$CONDUCTOR" \
  'import { useMemo, useState, useSyncExternalStore } from "react";' \
  'import { useEffect, useMemo, useState, useSyncExternalStore } from "react";' \
  '  const [step, setStep] = useState(0);' \
  '  const [step, setStep] = useState(() =>
    typeof window === "undefined"
      ? 0
      : Number(window.localStorage.getItem("aranje.acceptance-step") ?? 0),
  );
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("aranje.acceptance-step", String(step));
    }
  }, [step]);'

# 11 — the session installed during render, which is the defect §8 found:
# the server has no storage to swap, so the two passes disagree, React throws
# the server HTML away, and the re-render asks for a second session.
probe "A11 session installed during render" "session:" "$CONDUCTOR" \
  '  const session = useSyncExternalStore<AcceptanceSession | null>(
    () => () => {},
    acceptanceSession,
    () => null,
  );' \
  '  const [session] = useState<AcceptanceSession | null>(() =>
    typeof window === "undefined" ? null : startAcceptanceSession(),
  );' \
  'import { acceptanceSession, type AcceptanceSession } from "@/lib/acceptance/session";' \
  'import { startAcceptanceSession, type AcceptanceSession } from "@/lib/acceptance/session";'

# 12 — anything at all thrown while the reader works.
probe "A12 an error on the page" "console:" "$WATCH" \
  '    const timer = window.setInterval(tick, 250);' \
  '    window.setTimeout(() => {
      throw new Error("probe");
    }, 400);
    const timer = window.setInterval(tick, 250);'

echo
echo "kırmızı ${pass} · vacuous ${fail} · atlanan ${skipped}"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
