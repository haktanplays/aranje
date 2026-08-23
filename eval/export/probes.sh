#!/usr/bin/env bash
# Vacuity probes for 2M-A — the unit-suite half (spec 13.19 §18).
#
# Each probe puts back a way the export could quietly stop being true: a mono
# WAV, a swapped channel, a header that lies about its own size, a tie struck
# twice, a drum sent to a melodic channel, a bend that would detune a chord.
# The mutation is applied to the real source, one named suite is run, and the
# probe only counts if that suite goes red. The probes that need a running
# page live in browser-probes.sh, and the two that can only be judged by
# listening live in audio-probes.sh.
set -u

pass=0; fail=0
probe() {
  local name="$1" file="$2" find="$3" repl="$4" cmd="$5"
  # A leftover backup means another probe run is touching this file. Two
  # runs racing over one source silently restore each other's mutation and
  # can leave a real edit behind, so this refuses rather than guesses.
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
  if [ $? -ne 0 ]; then echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"; return; fi

  if eval "$cmd" >/dev/null 2>&1; then
    echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
  else
    echo "RED   $name"; pass=$((pass+1))
  fi
  mv "$file.probebak" "$file"
}

W="npx vitest run src/lib/export/wav-encoder.test.ts"
M="npx vitest run src/lib/export/midi-file.test.ts"
P="npx vitest run src/lib/export/export-plan.test.ts"
O="npx vitest run src/lib/export/export-orchestration.test.ts"
N="npx vitest run src/lib/audio/notated-plan.test.ts"
L="npx vitest run src/lib/song/legacy-audibility.test.ts"
B="npx vitest run src/lib/workspace/workspace-boundary.test.ts"
X="npx vitest run src/lib/export/worst-case.test.ts"

# 1 — the file claims one channel while carrying two, or carries only one
probe "1 the WAV is written as mono" \
  src/lib/export/wav-encoder.ts \
  '  view.setUint16(22, channelCount, true);' \
  '  view.setUint16(22, 1, true);' \
  "$W"

# 2 — left and right change places on the way out
probe "2 the channel order is reversed" \
  src/lib/export/wav-encoder.ts \
  '      const sample = channels[channel]![frame]!;' \
  '      const sample = channels[channelCount - 1 - channel]![frame]!;' \
  "$W"

# 3 — the header promises more audio than the file holds
probe "3 the header data size is wrong" \
  src/lib/export/wav-encoder.ts \
  '  view.setUint32(40, dataBytes, true);' \
  '  view.setUint32(40, dataBytes + 2, true);' \
  "$W"

# 4 — a sample outside the range wraps instead of clamping
probe "4 the float clamp is removed" \
  src/lib/export/wav-encoder.ts \
  '  if (sample >= 1) return INT16_MAX;
  if (sample <= -1) return INT16_MIN;
  return Math.round(sample * (sample < 0 ? -INT16_MIN : INT16_MAX));' \
  '  return Math.round(sample * INT16_MAX) | 0;' \
  "$W"

# 5 — a NaN from a broken render becomes a silent hole in the file
probe "5 a non-finite sample is silenced instead of refused" \
  src/lib/export/wav-encoder.ts \
  '      if (!Number.isFinite(sample)) {
        return { ok: false, code: "wav_non_finite_sample" };
      }' \
  '      if (!Number.isFinite(sample)) {
        view.setInt16(offset, 0, true);
        offset += BYTES_PER_SAMPLE;
        continue;
      }' \
  "$W"

# 6 — the tail goes, and the last note is chopped at the bar line
probe "6 the render tail is removed" \
  src/lib/export/export-plan.ts \
  '  const tailSeconds = audioExportLimits.tailSeconds;' \
  '  const tailSeconds = 0;' \
  "$P"

# 7 — the choice the user made is quietly discarded
probe "7 the chosen audition is ignored by the render" \
  src/lib/export/render-wav.ts \
  '      if (options.audibleTrackIds !== undefined) {
        setTrackAudibility(engine, options.audibleTrackIds);
      }' \
  '      void setTrackAudibility;' \
  "$O"

# 8 — the estimate stops being the file
probe "8 the size estimate drifts from the encoder" \
  src/lib/export/wav-encoder.ts \
  '  return RIFF_HEADER_BYTES + frames * channels * BYTES_PER_SAMPLE;' \
  '  return frames * channels * BYTES_PER_SAMPLE;' \
  "$P"

# 9 — MIDI stops being format 1
probe "9 the MIDI is written as format 0" \
  src/lib/export/midi-writer.ts \
  '    0x01, // format 1' \
  '    0x00, // format 0' \
  "$M"

# 10 — a copied PPQ constant, free to drift from the grid
probe "10 the MIDI PPQ is a copied constant" \
  src/lib/export/midi-plan.ts \
  '      ppq: PPQ,' \
  '      ppq: 480,' \
  "$M"

# 11 — the tempo map flattens to one BPM
probe "11 the tempo map becomes a flat BPM" \
  src/lib/export/midi-plan.ts \
  '    if (segment.writtenBpm === lastBpm) continue;' \
  '    if (lastBpm !== null) continue;' \
  "$M"

# 12 — the metre changes stop being written
probe "12 the time-signature events are dropped" \
  src/lib/export/midi-plan.ts \
  '    if (key === lastMeter) continue;' \
  '    if (lastMeter !== null) continue;' \
  "$M"

# 13 — a tie is struck again instead of held
probe "13 a tied note is re-struck" \
  src/lib/audio/schedule.ts \
  '          // A span that began in an earlier bar was already counted there.
          if (span.openStart) continue;' \
  '          // probe: the tie is forgotten' \
  "$M"

# 14 — the note-off arrives after the next strike of the same pitch
probe "14 note-off comes after the repeated note-on" \
  src/lib/export/midi-plan.ts \
  '  noteOff: 3,
  noteOn: 4,' \
  '  noteOff: 5,
  noteOn: 4,' \
  "$M"

# 15 — the score is told playback's shortened length
probe "15 MIDI carries the shortened playback duration" \
  src/lib/export/midi-plan.ts \
  '          tick: event.time + Math.max(1, event.durationTicks),' \
  '          tick: event.time + Math.max(1, Math.round(event.durationTicks * 0.92)),' \
  "$M"

# 16 — the drums go to a melodic channel and turn into a piano part
probe "16 the drum track leaves the percussion channel" \
  src/lib/export/midi-plan.ts \
  '    const channel = drums ? MIDI_DRUM_CHANNEL : channelOf.get(track.id)!;' \
  '    const channel = 0;' \
  "$M"

# 17 — an unknown instrument quietly becomes a piano
probe "17 an unknown instrument falls back to piano" \
  src/lib/export/midi-map.ts \
  '  const program = MIDI_PROGRAMS[instrumentId];
  if (program === undefined) {
    return {
      ok: false,
      code: "midi_instrument_unsupported",
      detail: instrumentId,
    };
  }
  return { ok: true, program };' \
  '  return { ok: true, program: MIDI_PROGRAMS[instrumentId] ?? 0 };' \
  "$M"

# 18 — a real pitch bend appears, which would detune every note on the channel
probe "18 a channel-wide pitch bend is written" \
  src/lib/export/midi-writer.ts \
  '    case "noteOn":
      if (!inChannel(event.channel)) return null;
      if (!inData(event.note) || !inData(event.velocity)) return null;
      return [0x90 | event.channel, event.note, event.velocity];' \
  '    case "noteOn":
      if (!inChannel(event.channel)) return null;
      if (!inData(event.note) || !inData(event.velocity)) return null;
      return [
        0xe0 | event.channel,
        0x00,
        0x50,
        0x90 | event.channel,
        event.note,
        event.velocity,
      ];' \
  "$M"

# 19 — the persisted level stops reaching CC7
probe "19 the persisted volume is not written as CC7" \
  src/lib/export/midi-map.ts \
  '  const amplitude = 10 ** (volumeDb / 20);
  return clampData(Math.round(amplitude * MIDI_DATA_RANGE.max));' \
  '  void volumeDb;
  return MIDI_DATA_RANGE.max;' \
  "$M"

# 20 — the persisted stereo position stops reaching CC10
probe "20 the persisted pan is not written as CC10" \
  src/lib/export/midi-map.ts \
  '  if (clamped === mixerLimits.pan.center) return 64;
  return clampData(Math.round((clamped + 1) * 63.5));' \
  '  void clamped;
  return 64;' \
  "$M"

# 21 — the metronome is recorded into the file
probe "21 the metronome reaches the export" \
  src/lib/export/render-wav.ts \
  '        metronomeEnabled: () => false,' \
  '        metronomeEnabled: () => true,' \
  "$O"

# 22 — a full-mix export starts consulting the session audition
probe "22 a full-mix export applies the audition anyway" \
  src/lib/export/render-wav.ts \
  '      if (options.audibleTrackIds !== undefined) {
        setTrackAudibility(engine, options.audibleTrackIds);
      }' \
  '      setTrackAudibility(engine, options.audibleTrackIds ?? []);' \
  "$O"

# 23 — "everything muted" is papered over with a fallback
probe "23 an empty audition falls back to every track" \
  src/lib/export/render-wav.ts \
  '      if (options.audibleTrackIds !== undefined) {' \
  '      if (options.audibleTrackIds !== undefined && options.audibleTrackIds.length > 0) {' \
  "$O"

# 24 — the phase-0 contract flags become an audibility decision again
probe "24 the legacy muted flag silences a track again" \
  src/lib/audio/engine.ts \
  '  channel.connect(master);

  if (isDrumInstrument(track.instrumentId)) {' \
  '  if (track.muted) channel.mute = true;
  channel.connect(master);

  if (isDrumInstrument(track.instrumentId)) {' \
  "$L"

# 25 — the export starts at whatever practice speed was set
probe "25 the practice rate reaches the exported tempo" \
  src/lib/export/render-wav.ts \
  '      scheduleSong(engine, buildTempoMap(song), {' \
  '      scheduleSong(engine, buildTempoMap(song, 50), {' \
  "$O"

# 26 — the score and the performance stop sharing one traversal
probe "26 the played plan is walked separately from the score" \
  src/lib/audio/schedule.ts \
  '  const notated = buildNotatedPlan(song);' \
  '  const notated = { ...buildNotatedPlan(song), events: [] as never[] };' \
  "$N"

# 27 — the composition root grows the export back into itself
probe "27 the Workspace budget is exceeded" \
  src/components/workspace/Workspace.tsx \
  '  /* ---------------------------------------------------------------- mixer */' \
  '  /* ---------------------------------------------------------------- mixer */
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p
  // p' \
  "$B"

# 28 — a component reaches past its view-model to the encoder
probe "28 the export sheet encodes for itself" \
  src/components/workspace/ExportSheet.tsx \
  'import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";' \
  'import { encodeWav } from "@/lib/export/wav-encoder";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";' \
  "$B"

# --------------------------------------------------------------- 2M-A.1 §3
# The worst-case arithmetic. The first report of this checkpoint quoted a
# figure taken from a 138 BPM fixture; these are the mutations that would
# have let that number through unnoticed.

# 38 — a comfortable tempo stands in for the slowest one the contract allows
probe "38 the worst case uses 120 BPM instead of the minimum" \
  eval/shared/export-worst-case.ts \
  '    title: "En Uzun Sure",
    bpm: bpmRange.min,' \
  '    title: "En Uzun Sure",
    bpm: 120,' \
  "$X"

# 39 — a shorter song stands in for every bar the contract allows
probe "39 the worst case is shorter than the bar limit" \
  eval/shared/export-worst-case.ts \
  '    sections: sectionsOf(
      songLimits.totalBars,
      (barIndex) =>
        barIndex === last' \
  '    sections: sectionsOf(
      8,
      (barIndex) =>
        barIndex === last' \
  "$X"

# 40 — the tail is reported but never rendered
probe "40 the tail leaves the frame count" \
  src/lib/export/export-plan.ts \
  '  const { totalSeconds } = renderDuration(song);
  const sampleRate = audioExportLimits.sampleRate;' \
  '  const { notatedSeconds: totalSeconds } = renderDuration(song);
  const sampleRate = audioExportLimits.sampleRate;' \
  "$X"

# 41 — the second channel falls out of the size formula
probe "41 the size formula drops a channel" \
  src/lib/export/export-plan.ts \
  '    bytes: wavByteLength(frames, channels),' \
  '    bytes: wavByteLength(frames, 1),' \
  "$X"

# 42 — the bit depth falls out of the size formula
probe "42 the size formula drops the bit depth" \
  src/lib/export/wav-encoder.ts \
  '  return RIFF_HEADER_BYTES + frames * channels * BYTES_PER_SAMPLE;' \
  '  return RIFF_HEADER_BYTES + frames * channels;' \
  "$X"

# 43 — the encoder and the estimate stop agreeing about the same frames
probe "43 the encoder writes a different size than the estimate" \
  src/lib/export/wav-encoder.ts \
  '  const bytes = new Uint8Array(RIFF_HEADER_BYTES + dataBytes);' \
  '  const bytes = new Uint8Array(RIFF_HEADER_BYTES + dataBytes + 2);' \
  "$X"

# 44 — the two worst cases collapse into one fixture again
probe "44 the heaviest fixture is the longest one" \
  eval/shared/export-worst-case.ts \
  '    bpm: 138,' \
  '    bpm: bpmRange.min,' \
  "$X"

# --------------------------------------------------------------- 2M-A.1 §4
# The pitch-bend evidence. The old check scanned raw bytes, which is not a
# statement about MIDI events at all; these prove the reader is doing real
# work rather than answering zero.

# 45 — the reader stops seeing pitch bends, so "none found" means nothing
probe "45 the reader is blind to pitch bend" \
  src/lib/dev/midi-reader.ts \
  '  return parsed.channelEvents.filter((event) => event.kind === "pitchBend").length;' \
  '  void parsed;
  return 0;' \
  "$M"

# 46 — the reader miscounts a channel message's data bytes and desynchronises
probe "46 the reader mis-sizes a channel message" \
  src/lib/dev/midi-reader.ts \
  '  0xe0: 2, // pitch bend' \
  '  0xe0: 1, // pitch bend' \
  "$M"

# 47 — the reader stops honouring meta lengths, so text bytes become events
probe "47 the reader ignores meta event lengths" \
  src/lib/dev/midi-reader.ts \
  '        const metaLength = readVlq();
        need(metaLength, "meta payload");' \
  '        const metaLength = 0;
        readVlq();
        need(metaLength, "meta payload");' \
  "$M"

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
