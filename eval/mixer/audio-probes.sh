#!/usr/bin/env bash
# 2L-C vacuity probes that only a rendered buffer can judge (spec 13.18 §16).
#
# Two claims in the offline render are about sound rather than state: that an
# expressive voice takes the same track mix as the sampler it belongs to, and
# that the metronome is not a track and survives every mute. Neither can be
# broken by a DOM assertion, so each mutation is measured the same way the
# claim is — rebuild the render bundle, render, read peak and RMS.
set -u

pass=0; fail=0

probe() {
  local name="$1" file="$2" find="$3" repl="$4"
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

  if npx vite build --config eval/mixer/vite.render.config.mts >/dev/null 2>&1; then
    if node eval/mixer/measure-audio.mjs >/tmp/aranje-audio-probe.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-audio-probe.log) claims)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (bundle build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 29 — the expressive layer hangs off the master, skipping the track's mix
probe "29 an expressive voice skips the track mix" \
  src/lib/audio/engine.ts \
  '      destination: voice.channel,' \
  '      destination: master,'

# 30 — the metronome is dragged into the audition it is supposed to outlive
probe "30 the metronome is muted with the tracks" \
  src/lib/audio/engine.ts \
  '  const audible = new Set(audibleTrackIds);
  for (const [trackId, voice] of engine.voices) {
    voice.channel.mute = !audible.has(trackId);
  }' \
  '  const audible = new Set(audibleTrackIds);
  for (const [trackId, voice] of engine.voices) {
    voice.channel.mute = !audible.has(trackId);
  }
  engine.metronome.click.volume.value = audible.size === 0 ? -Infinity : 0;'

# Leave the bundle as the committed sources describe it.
npx vite build --config eval/mixer/vite.render.config.mts >/dev/null 2>&1

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
