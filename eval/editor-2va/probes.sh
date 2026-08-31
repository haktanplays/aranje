#!/usr/bin/env bash
# Mutation probes for hearing a selection (2V-A §11).
#
# Each probe puts one defect back and asserts that a named test goes red for
# the right reason. Every mutant here is a way this feature can be wrong that
# somebody would actually write: a filter dropped, a bound removed, a loop
# authority forked, a cleanup path forgotten, a zero measured by an instrument
# that could not have seen anything else.
#
# The runner is stricter than "the command exited non-zero" (§11):
#
# - **Zero tests run** means the mutation broke the parser, not the guarantee.
# - **A timeout alone** says the machine was busy. It is not a finding.
# - **An equivalent mutant** cannot change behaviour, so green there is the
#   mutant's fault and not the test's. It is reported as VACUOUS, listed by
#   name, and never summed into the pass count.
#
#   ./eval/editor-2va/probes.sh
#
# The browser probes at the end need a server: `npx next start -p 3114`
# against a build that already carries the mutation is not possible, so they
# mutate the *harness* instead — which is the honest question there anyway
# ("would this run notice?").
set -u

pass=0; vacuous=0; invalid=0
declare -a VACUOUS_LIST=()
declare -a INVALID_LIST=()
LOG="${PROBE_LOG:-/tmp/aranje-2va-probe.log}"
BUDGET="${PROBE_TIMEOUT:-180}"

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
  if [ $? -ne 0 ]; then
    echo "INVALID $name (anchor missing)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: anchor missing")
    mv "$file.probebak" "$file"; return
  fi

  timeout "$BUDGET" bash -c "$cmd" > "$LOG" 2>&1
  local code=$?
  mv "$file.probebak" "$file"

  if [ $code -eq 124 ]; then
    echo "INVALID $name (timed out — a hang is not evidence)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: timeout")
    return
  fi

  local total failed
  total=$(grep -oE 'Tests +[0-9|a-z ]*\(([0-9]+)\)' "$LOG" | grep -oE '\(([0-9]+)\)$' | tr -d '()' | tail -1)
  failed=$(grep -oE 'Tests +([0-9]+) failed' "$LOG" | grep -oE '[0-9]+' | tail -1)
  total=${total:-0}; failed=${failed:-0}

  if [ "$total" -eq 0 ]; then
    echo "INVALID $name (no test ran — the mutation broke the build, not the guarantee)"
    invalid=$((invalid+1)); INVALID_LIST+=("$name: zero tests run")
    return
  fi
  if [ "$failed" -gt 0 ]; then
    echo "RED     $name  ($failed of $total)"; pass=$((pass+1))
  else
    echo "GREEN   $name  <-- VACUOUS ($total ran, none failed)"
    vacuous=$((vacuous+1)); VACUOUS_LIST+=("$name")
  fi
}

PLAN="npx vitest run src/lib/playback/selection-playback.test.ts src/lib/playback/selection-window.test.ts"
SCHED="npx vitest run src/lib/playback/selection-schedule.test.ts"
TRANSPORT="npx vitest run src/lib/playback/selection-transport.test.ts"
SESSION="npx vitest run src/lib/playback/listening-session.test.ts"
INTEGRITY="npx vitest run src/lib/playback/listening-integrity.test.ts"
CAPS="npx vitest run src/lib/song/selection-capability.test.ts src/lib/workspace/selection-listening.test.ts"
VERBS="npx vitest run src/lib/workspace/selection-verbs.test.ts"
LOOPS="npx vitest run src/lib/practice/range.test.ts src/lib/playback/selection-transport.test.ts"
HONEST="npx vitest run eval/editor-2va/honesty.test.ts"

echo "== §7 what the plan says the run is =="

probe "01 the plan hands on the section's own ticks, unconverted" \
  src/lib/playback/selection-playback.ts \
  '  const startTicks = offset + descriptor.startTicks;
  const endTicks = offset + descriptor.endTicks;' \
  '  const startTicks = descriptor.startTicks;
  const endTicks = descriptor.endTicks;' \
  "$PLAN"

probe "02 the plan takes every track, not the selected ones" \
  src/lib/playback/selection-playback.ts \
  '  const trackIds = [...descriptor.trackIds];' \
  '  const trackIds = song.tracks.map((track) => track.id);' \
  "$PLAN"

probe "03 an empty range is accepted as a range" \
  src/lib/playback/selection-playback.ts \
  '  if (endTicks <= startTicks) return { ok: false, reason: "empty_range" };' \
  '  if (endTicks < startTicks) return { ok: false, reason: "empty_range" };' \
  "$PLAN"

probe "04 a selection with nothing in it is offered anyway" \
  src/lib/playback/selection-playback.ts \
  '  if (audible.length === 0) return { ok: false, reason: "no_audible_notes" };' \
  '  if (false) return { ok: false, reason: "no_audible_notes" };' \
  "$PLAN"

probe "05 audibility is asked of the descriptor's melodic onset count" \
  src/lib/playback/selection-playback.ts \
  '  const audible = windowEvents(song, { startTicks, endTicks, trackIds });' \
  '  const audible = new Array(descriptor.onsetCount).fill(null);' \
  "$PLAN"

echo
echo "== §3 what a window means to the scheduler =="

probe "06 the track filter is dropped" \
  src/lib/playback/selection-playback.ts \
  '    event.time < window.endTicks &&
    window.trackIds.includes(event.trackId)' \
  '    event.time < window.endTicks' \
  "$PLAN $SCHED"

probe "07 the end bound is dropped" \
  src/lib/playback/selection-playback.ts \
  '    event.time < window.endTicks &&' \
  '    event.time < Number.POSITIVE_INFINITY &&' \
  "$PLAN $SCHED"

probe "08 the start bound is dropped, so the carry is struck again" \
  src/lib/playback/selection-playback.ts \
  '    event.time >= window.startTicks &&' \
  '    event.time >= 0 &&' \
  "$PLAN $SCHED"

probe "09 the tail is not clipped at the boundary" \
  src/lib/playback/selection-playback.ts \
  '  return Math.max(1, Math.min(event.durationTicks, room));' \
  '  return event.durationTicks;' \
  "$PLAN $SCHED"

# Retired twice, and the reason is worth keeping.
#
# "Clip to zero instead of one" (`Math.max(1, …)` removed) is an equivalent
# mutant: only an event *inside* the window is ever clipped, and inside the
# window `endTicks - time` is at least 1, so the guard can never fire.
# "Measure the room from the wrong end" is equivalent for the same reason —
# `endTicks` is never smaller than `endTicks - time`, so it only ever loosens
# a clip that probe 09 already removes entirely.
#
# The real question neither of them was asking: the drum lane is a separate
# loop in the scheduler, and a filter dropped there is invisible to every
# assertion about notes.
probe "10 the drum lane keeps playing outside the selection" \
  src/lib/audio/engine.ts \
  '    if (!inside(event.trackId, event.time)) continue;' \
  '' \
  "$SCHED"

probe "11 the engine schedules the whole song and ignores the window" \
  src/lib/audio/engine.ts \
  '    bounds === undefined || inWindow(bounds, { trackId, time });' \
  '    true || inWindow(bounds, { trackId, time });' \
  "$SCHED"

probe "12 the run ends where the song ends, not where the selection does" \
  src/lib/audio/engine.ts \
  '  const endTicks = bounds?.endTicks ?? engine.plan.totalTicks;' \
  '  const endTicks = engine.plan.totalTicks;' \
  "$SCHED"

echo
echo "== §4 one loop, and no drift =="

probe "13 a selection loop is answered with its section's bounds" \
  src/lib/practice/range.ts \
  '  if (loop.kind === "selection") return loop.bounds;' \
  '  if (loop.kind === "selection") return { startTicks: 0, endTicks: 768 };' \
  "$LOOPS"

probe "14 the loop starts one tick later on every turn" \
  src/lib/audio/playback.ts \
  '              bounds: { startTicks: plan.startTicks, endTicks: plan.endTicks },' \
  '              bounds: { startTicks: plan.startTicks + 1, endTicks: plan.endTicks },' \
  "$TRANSPORT"

probe "15 hearing it once leaves a loop running behind it" \
  src/lib/audio/playback.ts \
  '        : NO_LOOP,
      );' \
  '        : { kind: "selection", bounds: { startTicks: plan.startTicks, endTicks: plan.endTicks } },
      );' \
  "$TRANSPORT"

probe "16 a finished one-shot leaves the playhead past the end" \
  src/lib/audio/playback.ts \
  '      transport.ticks = plan.startTicks;
    }
    this.selectionPlayback = null;' \
  '      transport.ticks = plan.endTicks;
    }
    this.selectionPlayback = null;' \
  "$TRANSPORT"

probe "17 the end callback stops a loop too" \
  src/lib/audio/playback.ts \
  '    if (!plan || plan.mode !== "once") return;' \
  '    if (!plan) return;' \
  "$TRANSPORT"

echo
echo "== §5 the ways a run has to end =="

probe "18 turning the loop off leaves the loop set" \
  src/lib/audio/playback.ts \
  '    engine.expression.stopAll();
    this.setLoop(NO_LOOP);' \
  '    engine.expression.stopAll();' \
  "$TRANSPORT"

probe "19 stopping leaves the engine still bounded to the selection" \
  src/lib/audio/playback.ts \
  '    this.scheduleWholeSong(engine);' \
  '    void engine;' \
  "$TRANSPORT"

probe "20 a fast double press starts two runs" \
  src/lib/audio/playback.ts \
  '    if (this.selectionStart) {
      await this.selectionStart;' \
  '    if (false) {
      await this.selectionStart;' \
  "$TRANSPORT"

probe "21 an abort that arrives mid-build is ignored" \
  src/lib/audio/playback.ts \
  '      if (this.disposed || this.selectionToken !== token) return;' \
  '      if (this.disposed) return;' \
  "$INTEGRITY"

probe "22 an audio failure is thrown at a press handler that cannot catch it" \
  src/lib/audio/playback.ts \
  '      this.selectionPlayback = null;
      this.fail(error);' \
  '      this.selectionPlayback = null;
      throw error;' \
  "$INTEGRITY"

probe "23 a run outlives the selection it was started for" \
  src/lib/playback/listening-session.ts \
  '  return playbackSignature(playing) !== playbackSignature(selected);' \
  '  return false;' \
  "$SESSION"

probe "24 changing the instrument under a run does not stop it" \
  src/lib/playback/listening-session.ts \
  '  return [plan.startTicks, plan.endTicks, [...plan.trackIds].sort().join(",")].join(' \
  '  return [plan.startTicks, plan.endTicks, ""].join(' \
  "$SESSION"

probe "25 a selection loop survives the song changing under it" \
  src/lib/audio/use-playback.ts \
  '          loop.kind === "practice_range" && rangeIsLive(song, loop.range);' \
  '          loop.kind !== "practice_range" || rangeIsLive(song, loop.range);' \
  "$TRANSPORT"

echo
echo "== §2, §6, §9 the surface and what it must not touch =="

probe "26 the capability model stops asking whether there is anything to hear" \
  src/lib/song/selection-capability.ts \
  '      return context.hasAudibleNotes ? available : disabled(NOTHING_TO_HEAR);' \
  '      return available;' \
  "$CAPS"

probe "27 the drawer offers a verb the capability model refuses" \
  src/lib/workspace/selection-verbs.ts \
  '  { key: "onAudition", verb: "audition" },' \
  '' \
  "$VERBS"

probe "28 listening reaches for the history" \
  src/lib/workspace/use-selection-listening.ts \
  'import { shouldStopListening } from "@/lib/playback/listening-session";' \
  'import { shouldStopListening } from "@/lib/playback/listening-session";
import "@/lib/song/edit-history";' \
  "$INTEGRITY"

probe "29 the sentence the reader is given says 'tick'" \
  src/lib/playback/selection-playback.ts \
  'export const NO_AUDIBLE_NOTES = "Bu seçimde dinlenecek nota yok.";' \
  'export const NO_AUDIBLE_NOTES = "Bu tick aralığında schema slot yok.";' \
  "$PLAN $CAPS"

echo
echo "== §10 whether the browser run would notice =="

probe "30 the harness calls a desktop emulation a physical device pass" \
  eval/editor-2va/verify.mjs \
  'kind: "browser emulation — not a physical device",' \
  'kind: "physical device PASS",' \
  "$HONEST"

probe "31 the harness stops naming the surface it reads for drift" \
  eval/editor-2va/verify.mjs \
  '      if (node.clientHeight >= window.innerHeight) break;' \
  '      break;' \
  "$HONEST"

probe "32 the vacuity control for the zero-write claims is removed" \
  eval/editor-2va/verify.mjs \
  'and the same instruments would have seen a real edit' \
  'a step that asserts nothing' \
  "$HONEST"

echo
echo "-----------------------------------------------------------------"
echo "RED (a named test failed for the right reason): $pass"
echo "VACUOUS (mutant changed nothing observable):    $vacuous"
echo "INVALID (no test ran, or a timeout):            $invalid"
for entry in ${VACUOUS_LIST+"${VACUOUS_LIST[@]}"}; do echo "  vacuous: $entry"; done
for entry in ${INVALID_LIST+"${INVALID_LIST[@]}"}; do echo "  invalid: $entry"; done
[ "$vacuous" -eq 0 ] && [ "$invalid" -eq 0 ] || exit 1
