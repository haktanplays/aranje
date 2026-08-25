#!/usr/bin/env bash
# Vacuity probes for the launch-audio work and the expression benchmark
# (2O-B.1 + 2P-A §19).
#
# Forty mutations, each of which puts back a way this checkpoint's guarantees
# could be quietly untrue — a template that hands over silence, a bank that
# decodes the same seven files twenty-five times, a bend that never comes
# back, a benchmark candidate that leaks into the product — and asserts that a
# named test really goes red.
#
# The mutation is always the *dangerous behaviour*, never a syntax error: a
# probe that only breaks compilation proves nothing about the test.
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
AVAIL="$V src/lib/audio/preset-availability.test.ts"
TMPL="$V src/lib/song/song-lifecycle.test.ts src/lib/audio/preset-availability.test.ts"
BANK="$V src/lib/audio/buffer-bank.test.ts"
PBANK="$V src/lib/audio/preview-bank.test.ts"
PREV="$V src/lib/audio/preview-engine.test.ts"
WAV="$V src/lib/export/wav-encoder.test.ts src/lib/export/export-orchestration.test.ts"
CAND="$V eval/expression-benchmark/candidates.test.ts"
ANA="$V eval/expression-benchmark/analysis.test.ts"
BOUND="$V eval/expression-benchmark/boundary.test.ts"
CHORD="$V src/lib/chords/chord-boundary.test.ts"
EXPR="$V src/lib/audio/expression-plan.test.ts"
PROJ="$V src/lib/projects/project-store.test.ts"
# The matrix is a generated document, so the probe regenerates it and then
# asks the test about the document — mutating the source alone would prove
# nothing about what is committed.
MATRIX="npx tsx eval/expression-benchmark/matrix.ts && $V eval/expression-benchmark/boundary.test.ts"

echo "--- şablon ve availability ---"

probe "1 launch template goes back to the unplayable clean preset" \
  src/lib/song/song-templates.ts "$TMPL" \
  'import { getInstrument, isDrumInstrument } from "@/lib/instruments/registry";' \
  'import { corePresets, getInstrument, isDrumInstrument } from "@/lib/instruments/registry";' \
  '  const preset = playableCorePresets(plan.instrumentId)[0];' \
  '  const preset = corePresets(plan.instrumentId)[0];'

probe "2 the availability filter is removed from the preset list" \
  src/lib/audio/preset-availability.ts "$TMPL" \
  '  return corePresets(instrumentId).filter((preset) =>
    isPlayablePreset(instrumentId, preset.id),
  );' \
  '  return corePresets(instrumentId);'

probe "3 a missing pack counts as a silent success" \
  src/lib/audio/preset-availability.ts "$AVAIL" \
  '  if (!pack) return { status: "unavailable", reason: "sample_pack_missing" };' \
  '  if (!pack) {
    return { status: "available", source: "synthesised", sampleCount: 0, bankKey: null };
  }'

probe "4 the picker offers an unavailable preset as an ordinary one" \
  src/lib/audio/preset-availability.ts "$AVAIL" \
  '  return [...options, { preset: selected, playable: false }];' \
  '  return [...options, { preset: selected, playable: true }];'

probe "5 a legacy song is mutated to a fallback preset" \
  src/lib/audio/preset-availability.ts "$AVAIL" \
  '      silent.push({ trackId: track.id, name: track.name, reason: availability.reason });' \
  '      silent.push({ trackId: track.id, name: track.name, reason: availability.reason });
      (track as { presetId: string }).presetId = "high_gain";'

probe "15 a new track starts at 0 dB instead of the measured -6" \
  src/lib/song/song-templates.ts "$TMPL" \
  'export const DEFAULT_TRACK_VOLUME_DB = -6;' \
  'export const DEFAULT_TRACK_VOLUME_DB = 0;'

echo "--- paylaşılan preview bank ---"

probe "6 retention opens after the abandoned check, so an audition refetches" \
  src/lib/audio/playback.ts "$PBANK" \
  '    this.bankSession?.open(engine.context);

    if (this.disposed) {
      engine.dispose();
      throw new Error("disposed");
    }' \
  '    if (this.disposed) {
      engine.dispose();
      throw new Error("disposed");
    }
    this.bankSession?.open(engine.context);'

probe "7 the last release disposes the bank, so every audition decodes again" \
  src/lib/audio/buffer-bank.ts "$PBANK $BANK" \
  '        if (retention && !retention.disposed) {' \
  '        if (false && retention && !retention.disposed) {'

probe "8 in-flight coalescing is gone: every caller starts its own load" \
  src/lib/audio/buffer-bank.ts "$BANK" \
  '  const existing = state.banks.get(bankKey);
  if (existing) return handleFor(state, bankKey, existing);' \
  '  const existing = undefined as Entry | undefined;
  if (existing) return handleFor(state, bankKey, existing);'

probe "9 a failed load stays in the cache forever" \
  src/lib/audio/buffer-bank.ts "$BANK" \
  '  entry.loaded.catch(() => {
    // Guarded on identity: a retry that has already replaced this entry must
    // not be evicted by the failure of the one it replaced.
    if (state.banks.get(bankKey) === entry) state.banks.delete(bankKey);
  });' \
  '  entry.loaded.catch(() => {});'

probe "10 the context drops out of the cache identity" \
  src/lib/audio/buffer-bank.ts "$BANK" \
  '  const key = context as unknown as object;' \
  '  const key = CACHE as unknown as object;'

probe "11 two packs that differ only in their files share one bank" \
  src/lib/audio/packs.ts "$AVAIL $BANK" \
  '  return `${baseUrl}#${assets}`;' \
  '  return baseUrl;'

probe "12 closing the sheet leaves the voice playing" \
  src/lib/audio/preview-engine.ts "$PREV" \
  '    playback?.dispose();' \
  '    void playback;'

probe "13 disposing the session lets go of nothing" \
  src/lib/audio/preview-bank.ts "$PBANK" \
  '    for (const retention of this.retentions.values()) retention.dispose();' \
  '    for (const retention of this.retentions.values()) void retention;'

probe "14 a second engine — and so a second context — is left standing" \
  src/lib/audio/preview-engine.ts "$PREV" \
  '    stopHost();
    this.stop();' \
  '    stopHost();'

echo "--- kırpma ve seviye ---"

probe "16 the peak scanner stops seeing a clipped frame" \
  src/lib/export/wav-encoder.ts "$WAV" \
  '      if (magnitude >= 1) {' \
  '      if (magnitude >= 2) {'

probe "17 the reported peak is clamped, so the overshoot disappears" \
  src/lib/export/wav-encoder.ts "$WAV" \
  '      if (magnitude > peak) peak = magnitude;' \
  '      if (magnitude > peak) peak = Math.min(magnitude, 1);'

echo "--- bend ---"

probe "18 the production baseline becomes a copy in candidate code" \
  eval/expression-benchmark/candidates.ts "$CAND" \
  '  return bendAutomation(durationSeconds, articulation);' \
  '  return bendCandidateAutomation(
    { kind: "bend", targetCents: articulation === "bend_full" ? 200 : 100 },
    durationSeconds,
  );'

probe "19 a plain bend releases like a bend/release" \
  eval/expression-benchmark/candidates.ts "$CAND" \
  '  const returns =
    candidate.kind === "bend_release" || candidate.kind === "prebend_release";' \
  '  const returns = candidate.kind !== "prebend";'

probe "20 a bend/release stops short of zero on the way down" \
  eval/expression-benchmark/candidates.ts "$CAND" \
  '        cents: round(target * (1 - (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)))),' \
  '        cents: round(target * (1 - 0.6 * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)))),'

probe "21 a prebend starts from zero and climbs" \
  eval/expression-benchmark/candidates.ts "$CAND" \
  '    points.push({ timeSeconds: 0, cents: target, curve: "step" });
  } else {' \
  '    points.push({ timeSeconds: 0, cents: 0, curve: "step" });
  } else {'

probe "22 the vibrato starts during the rise instead of after it" \
  eval/expression-benchmark/candidates.ts "$CAND" \
  '    const from = reachedAt + delay;' \
  '    const from = 0;'

# The first attempt at this probe removed the cross-bar `openStart` guard,
# which the tied-bend fixtures never reach — they hold one note inside one bar.
# It broke nothing and proved nothing. The mechanism that actually makes a tie
# part of the note it follows is the span extension below.
probe "23 a tie stops extending the note, so the bend is replanned over one slot" \
  src/lib/tab/timeline.ts "$EXPR" \
  '        for (const span of open) span.endSlot = slotIndex;' \
  '        closeOpen();'

echo "--- slide ---"

probe "26 the slide takes its direction from a fret number, not the interval" \
  eval/expression-benchmark/candidates.ts "$CAND" \
  '  const from = -candidate.intervalSemitones * semitoneToCents;' \
  '  const from = Math.abs(candidate.intervalSemitones) * semitoneToCents;'

probe "27 a wide slide stops short of the note it is written on" \
  eval/expression-benchmark/candidates.ts "$CAND" \
  '  return transitionPoints("slide", 0, round(travel), from, 0).map((point) => ({
    timeSeconds: round(point.timeSeconds),
    cents: round(point.cents),
    curve: point.curve,
  }));' \
  '  return transitionPoints("slide", 0, round(travel), from, from * 0.25).map((point) => ({
    timeSeconds: round(point.timeSeconds),
    cents: round(point.cents),
    curve: point.curve,
  }));'

echo "--- akor sesi ve tını ---"

probe "28 a steady voice with nothing asked of it is modulated anyway" \
  src/lib/audio/expression-plan.ts "$EXPR" \
  '    pitchAutomation: flatPitch(),' \
  '    pitchAutomation: vibratoAutomation(durationSeconds),'

probe "29 the fret-noise candidate stops being deterministic" \
  eval/expression-benchmark/analysis.ts "$ANA" \
  '    out[index] = (state / 0xffffffff) * 2 - 1;' \
  '    out[index] = Math.random() * 2 - 1;'

echo "--- render ile ölçülen iddialar ---"
# These three are claims about rendered audio, so the instrument is the render
# itself: the bundle is rebuilt and all 42 fixtures are re-measured. One round
# costs about 45 seconds and the render is byte-deterministic, so a mutation
# that changes nothing would show as an unchanged artefact rather than as noise.
RENDER="npx vite build --config eval/expression-benchmark/vite.expression.config.mts && node eval/expression-benchmark/measure.mjs"

probe "24 the legato slide strikes its target, so it is no longer legato" \
  eval/expression-benchmark/render-entry.ts "$RENDER" \
  '  "slide-06-legato-up-4": {
    what: "legato slide adayı, +4 — bugünküyle aynı semantik",
    group: "slide",
    song: twoNotes("C4", 5, "slide"),
    plan: keepPlan,' \
  '  "slide-06-legato-up-4": {
    what: "legato slide adayı, +4 — bugünküyle aynı semantik",
    group: "slide",
    song: twoNotes("C4", 5, "slide"),
    plan: withTargetAttack("C4", 0.6),'

probe "25 the shift slide stops striking its target, so it is legato again" \
  eval/expression-benchmark/render-entry.ts "$RENDER" \
  '    const target = base.notes.find(
      (entry) => entry.pitch === targetPitch && entry.chainRole === "target",
    );
    if (!target) return base;' \
  '    const target = base.notes.find(
      (entry) => entry.pitch === targetPitch && entry.chainRole === "target",
    );
    if (target || !target) return base;'

probe "30 the crossfade candidate hides its second physical source" \
  eval/expression-benchmark/render-entry.ts "$RENDER" \
  '    source.connect(gain);
    gain.connect(voice.channel);
    source.start(from);
    return 1;' \
  '    source.connect(gain);
    gain.connect(voice.channel);
    source.start(from);
    return 0;'

echo "--- sınırlar ---"

probe "31 a benchmark candidate becomes part of the Song Contract" \
  src/lib/song/schema.ts "$BOUND" \
  '  "hammer_on",
  "pull_off",
]);' \
  '  "hammer_on",
  "pull_off",
  "shift_slide",
]);'

probe "32 the benchmark reaches the fingerprint" \
  eval/expression-benchmark/candidates.ts "$BOUND" \
  'import { desiredGlideSeconds, transitionPoints } from "@/lib/audio/legato-chain";' \
  'import { desiredGlideSeconds, transitionPoints } from "@/lib/audio/legato-chain";
import "@/lib/copilot/fingerprint";'

probe "33 a benchmark option leaks into a sheet" \
  src/components/workspace/ChordBuilderSheet.tsx "$BOUND" \
  'import { Sheet, SheetButton } from "@/components/workspace/Sheet";' \
  'import { SHIFT_ATTACK_LEVELS } from "../../../eval/expression-benchmark/candidates";
import { Sheet, SheetButton } from "@/components/workspace/Sheet";'

probe "34 an external sample URL appears in the benchmark" \
  eval/expression-benchmark/candidates.ts "$BOUND" \
  'const round = (value: number): number => Math.round(value * 1e6) / 1e6;' \
  'const round = (value: number): number => Math.round(value * 1e6) / 1e6;
const REFERENCE_SAMPLE = "https://example.com/samples/bend-reference.mp3";
void REFERENCE_SAMPLE;'

probe "35 the articulation matrix drops one of the contract enum members" \
  eval/expression-benchmark/matrix.ts "$MATRIX" \
  'const CONTRACT: readonly Articulation[] = articulationSchema.options;' \
  'const CONTRACT: readonly Articulation[] = articulationSchema.options.filter(
  (name) => name !== "slide",
);'

probe "36 the source audit claims a competitor reference it never had" \
  eval/expression-benchmark/OFFICIAL-SOURCES.md "$BOUND" \
  'referenceAudioAvailable: false' \
  'referenceAudioAvailable: true'

probe "37 the composition root grows past its budget" \
  src/components/workspace/Workspace.tsx "$BOUND" \
  '"use client";' \
  '"use client";
// probe padding 01
// probe padding 02
// probe padding 03
// probe padding 04
// probe padding 05
// probe padding 06
// probe padding 07
// probe padding 08
// probe padding 09
// probe padding 10'

probe "38 production code imports the evaluation harness" \
  src/lib/chords/chord-audition.ts "$CHORD" \
  'import { chordPreviewLimits } from "@/lib/limits";' \
  'import { chordPreviewLimits } from "@/lib/limits";
import "../../../eval/expression-benchmark/candidates";'

probe "39 an audition builds a second commit path" \
  src/lib/workspace/use-audition.ts "$CHORD" \
  '      engine.start(' \
  '      const commit = (): void => undefined;
      commit();
      engine.start('

probe "40 a commit lands in the project the tab left, not the one it opened" \
  src/lib/projects/active-project.ts "$PROJ" \
  '      const written = writeRecord(options.storage, active.id, song, options.now());' \
  '      const written = writeRecord(options.storage, options.id, song, options.now());'

echo
echo "kırmızı: $pass   boş (yeşil): $fail   atlanan: $skipped"
[ "$fail" -eq 0 ] && [ "$skipped" -eq 0 ]
