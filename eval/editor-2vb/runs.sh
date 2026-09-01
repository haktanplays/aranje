#!/usr/bin/env bash
# Ten consecutive acceptance runs of both harnesses (2V-B §11).
#
# Consecutive and unattended: a suite that is green once is a suite that was
# green once. Each run's totals are appended to RUNS.json, and `everyRunGreen`
# is the only line that matters — one red run makes the series red however the
# other nine went.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT="eval/editor-2vb/artifacts"
mkdir -p "$OUT"
RUNS="${RUNS:-10}"
: > /tmp/2vb-runs.jsonl

for index in $(seq 1 "$RUNS"); do
  node eval/editor-2vb/actions.mjs > "/tmp/2vb-actions-$index.log" 2>&1
  actions_exit=$?
  actions=$(tail -2 "/tmp/2vb-actions-$index.log" | tr -d '\n' | grep -o '[0-9]*/[0-9]* · failed=[0-9]*' || echo "?")

  node eval/editor-2vb/functional.mjs > "/tmp/2vb-functional-$index.log" 2>&1
  functional_exit=$?
  functional=$(tail -2 "/tmp/2vb-functional-$index.log" | tr -d '\n' | grep -o '[0-9]*/[0-9]* · failed=[0-9]*' || echo "?")

  echo "{\"run\":$index,\"actions\":\"$actions\",\"actionsExit\":$actions_exit,\"functional\":\"$functional\",\"functionalExit\":$functional_exit}" \
    >> /tmp/2vb-runs.jsonl
  echo "run $index · actions $actions (exit $actions_exit) · functional $functional (exit $functional_exit)"
done

python3 - "$OUT" <<'PY'
import json, sys
rows = [json.loads(line) for line in open("/tmp/2vb-runs.jsonl")]
green = all(r["actionsExit"] == 0 and r["functionalExit"] == 0 for r in rows)
out = {
    "kind": "browser emulation — not a physical device",
    "runs": len(rows),
    "everyRunGreen": green,
    "rows": rows,
}
with open(f"{sys.argv[1]}/RUNS.json", "w") as handle:
    handle.write(json.dumps(out, indent=2) + "\n")
print("everyRunGreen:", green, "over", len(rows), "runs")
PY
