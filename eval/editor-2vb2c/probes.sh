#!/usr/bin/env bash
# Twelve corruptions of the evidence model, each required to go red
# (2V-B.2c §3 step 16).
#
# The round this belongs to exists because a harness reported eight steps
# passed that nobody had performed. A suite that catches that today says
# nothing about whether it will catch it tomorrow, so each probe here puts
# the defect *back* — the exact shape of it, one edit at a time — and demands
# that the verification fail.
#
# **Run this alone.** The probes edit source in place and restore it
# afterwards; a test run started beside them measures a half-mutated tree and
# reports a failure that is an artefact of the runner, not of the code. That
# happened once in 2V-B.2 and cost a full re-run.
#
# Usage:  eval/editor-2vb2c/probes.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

OUT="eval/editor-2vb2c/artifacts"
mkdir -p "$OUT"
RESULTS="$OUT/PROBES.json"
LOG=$(mktemp)
PASSED=0
FAILED=0
ROWS=()

# Replace exactly one occurrence, and prove it happened.
apply() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
source = open(path, encoding="utf-8").read()
if old not in source:
    print(f"ANCHOR MISSING in {path}")
    sys.exit(2)
changed = source.replace(old, new, 1)
if changed == source:
    print(f"MUTATION CHANGED NOTHING in {path}")
    sys.exit(2)
open(path, "w", encoding="utf-8").write(changed)
PY
}

# Run a vitest file and insist it both ran tests and went red.
expect_red() {
  local target="$1"
  if ! npx vitest run "$target" > "$LOG" 2>&1; then
    if grep -qE "Tests +[0-9]+ failed" "$LOG"; then
      return 0
    fi
    echo "    (the suite failed without running tests — not a finding)"
    return 1
  fi
  return 1
}

probe() {
  local name="$1" file="$2" old="$3" new="$4" target="$5"
  echo "· $name"
  cp "$file" "$file.probe-backup"
  if ! apply "$file" "$old" "$new"; then
    echo "  INVALID — the mutation did not apply"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"invalid\",\"detail\":\"mutation did not apply\"}")
    FAILED=$((FAILED + 1))
    mv "$file.probe-backup" "$file"
    return
  fi
  local delta
  delta=$(diff "$file.probe-backup" "$file" | grep -c '^[<>]' || true)
  if expect_red "$target"; then
    echo "  red as it should be (mutation touched $delta lines)"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"red\",\"mutatedLines\":$delta,\"target\":\"$target\"}")
    PASSED=$((PASSED + 1))
  else
    echo "  STAYED GREEN — the verification does not catch this"
    ROWS+=("{\"probe\":\"$name\",\"result\":\"green\",\"mutatedLines\":$delta,\"target\":\"$target\"}")
    FAILED=$((FAILED + 1))
  fi
  mv "$file.probe-backup" "$file"
}

STEPS=src/lib/acceptance/batch-steps.ts
CONTRACT=src/lib/acceptance/step-contract.ts
WITNESS=src/lib/acceptance/production-witness.ts
ROWSRC=src/lib/acceptance/step-rows.ts
REPORT=src/lib/acceptance/batch-report.ts

CONTROLS=src/lib/acceptance/negative-controls.test.ts
INTEGRITY=src/lib/acceptance/evidence-integrity.test.ts

echo "── an absence completes a step again (§2 rule 1) ──"
probe "1 · a missing contract item no longer blocks the step" "$STEPS" \
  '  if (!contractMet(expect, trace, facts)) shortfalls.push("no_production_event");' \
  '  if (false) shortfalls.push("no_production_event");' \
  "$CONTROLS"

probe "2 · isolation stands in for completion again" "$STEPS" \
  '  if (!contractMet(expect, trace, facts)) shortfalls.push("no_production_event");' \
  '  if (!isolationHeld(expect, trace) && !contractMet(expect, trace, facts)) {
    shortfalls.push("no_production_event");
  }' \
  "$INTEGRITY"

probe "3 · an unrecognised contract passes by default" "$CONTRACT" \
  '  if (contract.kind === "survey_only") return true;
  return contractItems(contract, trace, facts).every((item) => item.present);' \
  '  if (contract.kind === "survey_only") return true;
  return contractItems(contract, trace, facts).some((item) => item.present);' \
  "$CONTROLS"

echo "── the witness stops witnessing (§3 step 4) ──"
probe "4 · a selection that never grew counts as extended" "$WITNESS" \
  '      if (continues && heldEnd !== null && editor.endTicks > heldEnd) {' \
  '      if (heldEnd !== null) {' \
  "$CONTROLS"

probe "5 · an extension may start somewhere else" "$WITNESS" \
  '      const continues =
        heldSection === editor.sectionId && heldStart === editor.startTicks;' \
  '      const continues = heldSection === editor.sectionId;' \
  "$CONTROLS"

probe "6 · forward-only playback counts as a loop traversal" "$WITNESS" \
  '        sample.ticks < lastLoopTick &&
        sample.ticks >= loopLow' \
  '        sample.ticks !== lastLoopTick' \
  "$CONTROLS"

probe "7 · a transport that never played can be paused" "$WITNESS" \
  '    if (sample.status === "paused" && facts.played) {' \
  '    if (sample.status === "paused") {' \
  "$CONTROLS"

probe "8 · a paused tick may drift and still count as held" "$WITNESS" \
  '      if (pausedAt !== null && sample.ticks === pausedAt) {' \
  '      if (pausedAt !== null) {' \
  src/lib/acceptance/production-witness.test.ts

echo "── the two listening scopes collapse into one (§3 step 6) ──"
probe "9 · 11A accepts any number of instruments" "$CONTRACT" \
  '          present: facts.listenFilters.some((filter) => filter.length === 1),' \
  '          present: facts.listenFilters.length > 0,' \
  "$CONTROLS"

probe "10 · 11B accepts a single instrument" "$CONTRACT" \
  '          present: facts.listenFilters.some((filter) => filter.length >= 2),' \
  '          present: facts.listenFilters.length > 0,' \
  "$CONTROLS"

echo "── the report lies about itself again (§3 steps 11–13) ──"
probe "11 · a reached step is valid whatever arrived" "$ROWSRC" \
  '  if (input.passed) return "valid";' \
  '  return "valid";
  if (input.passed) return "valid";' \
  "$CONTROLS"

probe "12 · a step nobody reached reports as held and passed" "$ROWSRC" \
  '      evidence: state?.evidence ?? "blocked",
      isolation: state?.isolation ?? "not_measured",' \
  '      evidence: state?.evidence ?? "valid",
      isolation: state?.isolation ?? "held",' \
  "$CONTROLS"

probe "13 · the block stops checking its own consistency" "$ROWSRC" \
  '  const broken: string[] = [];' \
  '  const broken: string[] = [];
  if (input.rows.length >= 0) return broken;' \
  "$CONTROLS"

probe "14 · the hearing line answers itself" "$REPORT" \
  '  if (given === undefined || given === null || given === "") return "ölçülmedi";' \
  '  if (given === undefined || given === null || given === "") return "evet";' \
  "$CONTROLS"

printf '{\n  "generatedAt": "%s",\n  "sha": "%s",\n  "passed": %d,\n  "failed": %d,\n  "probes": [\n    %s\n  ]\n}\n' \
  "$(date -u +%FT%TZ)" "$(git rev-parse HEAD)" "$PASSED" "$FAILED" \
  "$(IFS=$'\n'; echo "${ROWS[*]}" | paste -sd, - | sed 's/,/,\n    /g')" \
  > "$RESULTS"

echo
echo "$PASSED red · $FAILED not red · results in $RESULTS"
[ "$FAILED" -eq 0 ]
