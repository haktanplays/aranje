#!/usr/bin/env bash
# Vacuity probes for 2L-C — the unit-suite half (spec 13.18 §16).
#
# Each probe puts back a way the mixer could quietly stop being true: a
# clamped slider, a level that leaks to every channel, mute written into the
# song, a stale draft that lands anyway, a fingerprint that stops following
# the mix. The mutation is applied to the real source, one named suite is
# run, and the probe only counts if that suite goes red. The probes that
# need a running page live in browser-probes.sh, and the two that can only
# be judged by listening live in audio-probes.sh.
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

M="npx vitest run src/lib/song/track-mix.test.ts"
R="npx vitest run src/lib/audio/track-mix-runtime.test.ts"
ST="npx vitest run src/lib/song/track-mix-store.test.ts"
SC="npx vitest run src/lib/copilot/scope.test.ts"
B="npx vitest run src/lib/workspace/workspace-boundary.test.ts"

# 1 — a volume out of range is quietly pulled back inside it
probe "1 volume is clamped instead of refused" \
  src/lib/song/track-mix.ts \
  '  const mixes =
    command.kind === "update_track_mix" ? command.mixes : command.opened;

  for (const [trackId, mix] of Object.entries(mixes)) {
    if (!song.tracks.some((track) => track.id === trackId)) {
      return { ok: false, error: { code: "track_not_found" } };
    }
    if (!inRange(mix.volumeDb, mixerLimits.volumeDb.min, mixerLimits.volumeDb.max)) {
      return { ok: false, error: { code: "volume_out_of_range" } };
    }' \
  '  const clampDb = (value: number) =>
    Number.isFinite(value)
      ? Math.min(Math.max(value, mixerLimits.volumeDb.min), mixerLimits.volumeDb.max)
      : mixerLimits.volumeDb.min;
  const mixes = Object.fromEntries(
    Object.entries(
      command.kind === "update_track_mix" ? command.mixes : command.opened,
    ).map(([id, mix]) => [id, { ...mix, volumeDb: clampDb(mix.volumeDb) }]),
  );

  for (const [trackId, mix] of Object.entries(mixes)) {
    if (!song.tracks.some((track) => track.id === trackId)) {
      return { ok: false, error: { code: "track_not_found" } };
    }' \
  "$M"

# 2 — a stereo position out of range is quietly pulled back inside it
probe "2 pan is clamped instead of refused" \
  src/lib/song/track-mix.ts \
  '    if (!inRange(mix.pan, mixerLimits.pan.min, mixerLimits.pan.max)) {
      return { ok: false, error: { code: "pan_out_of_range" } };
    }
  }

  const tracks = song.tracks.map((track) => {
    const mix = mixes[track.id];
    return mix === undefined ? track : withMix(track, mix);
  });' \
  '  }

  const clampPan = (value: number) =>
    Math.min(Math.max(value, mixerLimits.pan.min), mixerLimits.pan.max);
  const tracks = song.tracks.map((track) => {
    const mix = mixes[track.id];
    return mix === undefined
      ? track
      : withMix(track, { ...mix, pan: clampPan(mix.pan) });
  });' \
  "$M"

# 3 — one track's level is written onto every channel in the graph
probe "3 one track's level reaches every channel" \
  src/lib/audio/engine.ts \
  '  const voice = engine.voices.get(trackId);
  if (!voice) return false;
  voice.channel.volume.value = volumeDb;
  voice.channel.pan.value = pan;
  return true;' \
  '  const voice = engine.voices.get(trackId);
  if (!voice) return false;
  for (const other of engine.voices.values()) {
    other.channel.volume.value = volumeDb;
    other.channel.pan.value = pan;
  }
  return true;' \
  "$R"

# 4 — changing who is heard moves the levels as well
probe "4 an audibility change moves the levels" \
  src/lib/audio/engine.ts \
  '  const audible = new Set(audibleTrackIds);
  for (const [trackId, voice] of engine.voices) {
    voice.channel.mute = !audible.has(trackId);
  }' \
  '  const audible = new Set(audibleTrackIds);
  for (const [trackId, voice] of engine.voices) {
    const on = audible.has(trackId);
    voice.channel.mute = !on;
    voice.channel.volume.value = on ? voice.channel.volume.value : -60;
  }' \
  "$R"

# 5 — mute becomes a field of the music
probe "5 mute is written into the Song" \
  src/lib/song/track-mix.ts \
  '  const next: Track = { ...track, volumeDb: mix.volumeDb };' \
  '  const next: Track = { ...track, volumeDb: mix.volumeDb, muted: false };' \
  "$ST"

# 6 — solo becomes a field of the music
probe "6 solo is written into the Song" \
  src/lib/song/track-mix.ts \
  '  const next: Track = { ...track, volumeDb: mix.volumeDb };' \
  '  const next: Track = { ...track, volumeDb: mix.volumeDb, soloed: true };' \
  "$ST"

# 7 — cancel forgets the draft without putting the graph back
probe "7 cancel does not restore the runtime" \
  src/lib/audio/playback.ts \
  '    this.mixOverrides.clear();
    if (!this.engine) return;
    for (const track of this.song.tracks) {
      writeTrackMix(this.engine, track.id, track.volumeDb, track.pan ?? 0);
    }' \
  '    this.mixOverrides.clear();' \
  "$R"

# 8 — a committed mix leaves a stale preview standing on top of it
probe "8 a committed mix loses to a stale preview" \
  src/lib/audio/playback.ts \
  '    this.song = next;
    this.mixOverrides.clear();' \
  '    this.song = next;' \
  "$R"

# 9 — a level asked for before the graph existed is dropped on build
probe "9 the graph forgets a level staged before it existed" \
  src/lib/audio/playback.ts \
  '    for (const [trackId, mix] of this.mixOverrides) {
      writeTrackMix(engine, trackId, mix.volumeDb, mix.pan);
    }' \
  '    this.mixOverrides.clear();' \
  "$R"

# 10 — an audition asked for before the graph existed is dropped on build
probe "10 the graph forgets an audition set before it existed" \
  src/lib/audio/playback.ts \
  '    if (this.audibleTrackIds !== null) {
      writeTrackAudibility(engine, this.audibleTrackIds);
    }' \
  '    void writeTrackAudibility;' \
  "$R"

# 11 — mute stops being the more specific instruction
probe "11 mute stops beating solo" \
  src/lib/song/track-mix.ts \
  '      (track) =>
        !pruned.muted.has(track.id) &&
        (!soloing || pruned.soloed.has(track.id)),' \
  '      (track) =>
        soloing ? pruned.soloed.has(track.id) : !pruned.muted.has(track.id),' \
  "$M"

# 12 — a silent song is "fixed" by a fallback nobody asked for
probe "12 every track muted invents a fallback" \
  src/lib/song/track-mix.ts \
  '  const pruned = pruneAudition(song, state);
  const soloing = pruned.soloed.size > 0;
  return song.tracks' \
  '  const pruned = pruneAudition(song, state);
  const soloing = pruned.soloed.size > 0;
  if (pruned.muted.size >= song.tracks.length && !soloing) {
    return song.tracks.map((track) => track.id);
  }
  return song.tracks' \
  "$M"

# 13 — a deleted track leaves its mute behind for whoever gets that id next
probe "13 a deleted track keeps its audition" \
  src/lib/song/track-mix.ts \
  '  const live = new Set(song.tracks.map((track) => track.id));' \
  '  return state;
  const live = new Set(song.tracks.map((track) => track.id));' \
  "$M"

# 14 — a draft applies onto music it was never read from
probe "14 a stale draft is not stale" \
  src/lib/song/track-mix.ts \
  '  return !sameSong(openedSong, currentSong);' \
  '  void openedSong;
  void currentSong;
  return false;' \
  "$M"

# 15 — a mix-only change stops being recognised, so every slider rebuilds
probe "15 a mix change is treated as a rebuild" \
  src/lib/song/track-mix.ts \
  '  const sameOtherwise = sameSong(' \
  '  if (previous) return false;
  const sameOtherwise = sameSong(' \
  "$M"

# 16 — the levels stop moving the Copilot fingerprint
probe "16 the fingerprint stops following the mix" \
  src/lib/copilot/scope.ts \
  '    tracks: digestOf(song.tracks),' \
  '    tracks: digestOf(
      song.tracks.map(({ volumeDb, pan, ...rest }) => {
        void volumeDb;
        void pan;
        return rest;
      }),
    ),' \
  "$ST"

# 17 — the locked surface stops refusing a model that moved a track mix
probe "17 Copilot may write the track mix" \
  src/lib/copilot/scope.ts \
  '  if (before.tracks !== after.tracks) {
    violations.push({' \
  '  if (false as boolean) {
    violations.push({' \
  "$SC"

# 18 — the project file starts carrying how someone was listening
probe "18 project export carries the session audition" \
  src/lib/project/project-file.ts \
  '    text: serializeProjectFile({
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      song: parsed.data,
    }),' \
  '    text: serializeProjectFile({
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      song: {
        ...parsed.data,
        tracks: parsed.data.tracks.map((track) => ({ ...track, muted: false })),
      },
    }),' \
  "$ST"

# 19 — the composition root grows the mixer back into itself
probe "19 the Workspace budget is exceeded" \
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

# 20 — the sheet reaches past its view-model straight to the audio graph
probe "20 the mixer sheet reaches the engine" \
  src/components/workspace/MixerSheet.tsx \
  'import { mixerLimits } from "@/lib/limits";' \
  'import { setTrackMix } from "@/lib/audio/engine";
import { mixerLimits } from "@/lib/limits";' \
  "$B"

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
