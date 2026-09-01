#!/usr/bin/env bash
# The repeated verification the round has to pass before it can be committed
# (2V-B.1 §19).
#
# Ten consecutive green runs of the targeted suite, ten of the browser
# acceptance, four of the whole test suite. Consecutive matters: a run that
# fails and is retried until it passes is a flaky test being laundered, so a
# failure here restarts the count rather than being skipped.
#
# Each run records how many tests actually ran. "Ten times green" over a
# command that matched no tests is a sentence about nothing, and §19 asks for
# manifests with non-zero counts precisely so that cannot be written.
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT="eval/editor-2vb1/artifacts"
mkdir -p "$OUT"
LOG=$(mktemp)

TARGETED=(
  src/lib/acceptance
  src/lib/audio/active-voices.test.ts
  src/lib/audio/expressive-voice.test.ts
  src/lib/audio/playback-resume.test.ts
  src/lib/audio/playback.test.ts
  src/lib/audio/playback-count-in.test.ts
  src/lib/audio/pan.test.ts
  src/lib/song/workspace-events.test.ts
  src/lib/song/selection-action-canon.test.ts
)

rows_targeted=()
rows_full=()
rows_browser=()
ok=1

count_tests() {
  grep -oE "Tests +[0-9]+ passed" "$1" | grep -oE "[0-9]+" | tail -1
}

echo "── targeted suite × 10 ──"
for run in $(seq 1 10); do
  if npx vitest run "${TARGETED[@]}" > "$LOG" 2>&1; then
    tests=$(count_tests "$LOG")
    if [ -z "$tests" ] || [ "$tests" -eq 0 ]; then
      echo "  run $run: green over zero tests — not a pass"
      ok=0
      rows_targeted+=("{\"run\":$run,\"green\":false,\"tests\":0}")
    else
      echo "  run $run: $tests tests"
      rows_targeted+=("{\"run\":$run,\"green\":true,\"tests\":$tests}")
    fi
  else
    echo "  run $run: FAILED"
    tail -25 "$LOG"
    ok=0
    rows_targeted+=("{\"run\":$run,\"green\":false,\"tests\":0}")
  fi
done

echo "── whole suite × 4 ──"
for run in $(seq 1 4); do
  if npm test > "$LOG" 2>&1; then
    tests=$(count_tests "$LOG")
    echo "  run $run: $tests tests"
    rows_full+=("{\"run\":$run,\"green\":true,\"tests\":${tests:-0}}")
    [ -z "$tests" ] && ok=0
  else
    echo "  run $run: FAILED"
    tail -25 "$LOG"
    ok=0
    rows_full+=("{\"run\":$run,\"green\":false,\"tests\":0}")
  fi
done

if [ "${RUNS_BROWSER:-1}" = "1" ]; then
  echo "── browser acceptance × 10 ──"
  SHA="$(git rev-parse --short HEAD)"
  for run in $(seq 1 10); do
    if SHA="$SHA" node eval/editor-2vb1/acceptance.mjs > "$LOG" 2>&1; then
      line=$(grep -oE "[0-9]+/[0-9]+ checks" "$LOG" | tail -1)
      echo "  run $run: $line"
      rows_browser+=("{\"run\":$run,\"green\":true,\"checks\":\"$line\"}")
    else
      echo "  run $run: FAILED"
      grep FAIL "$LOG" | head -10
      ok=0
      rows_browser+=("{\"run\":$run,\"green\":false,\"checks\":\"\"}")
    fi
  done
fi

join() { local IFS=$'\n'; echo "$*" | paste -sd, - | sed 's/,/,\n      /g'; }

cat > "$OUT/RUNS.json" <<JSON
{
  "generatedAt": "$(date -u +%FT%TZ)",
  "sha": "$(git rev-parse HEAD)",
  "targeted": {
    "files": "$(printf '%s ' "${TARGETED[@]}")",
    "runs": [
      $(join "${rows_targeted[@]}")
    ]
  },
  "full": {
    "runs": [
      $(join "${rows_full[@]}")
    ]
  },
  "browser": {
    "runs": [
      $(join "${rows_browser[@]:-}")
    ]
  },
  "allGreen": $([ "$ok" -eq 1 ] && echo true || echo false)
}
JSON

echo
[ "$ok" -eq 1 ] && echo "all consecutive runs green · $OUT/RUNS.json" || echo "NOT all green"
[ "$ok" -eq 1 ]
