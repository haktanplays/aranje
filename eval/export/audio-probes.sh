#!/usr/bin/env bash
# 2M-A vacuity probes that only a rendered buffer can judge (spec 13.19 §18).
#
# Three claims about the exported audio cannot be broken by a DOM assertion:
# that the persisted pan reaches the file, that a full-mix export ignores the
# session audition, and that no metronome is recorded. Each mutation is
# measured the same way the claim is — rebuild the render bundle, render,
# read peak and RMS off the samples.
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

  if npx vite build --config eval/export/vite.render.config.mts >/dev/null 2>&1; then
    if node eval/export/measure-audio.mjs >/tmp/aranje-audio-probe.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-audio-probe.log) iddia)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (bundle build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 35 — the persisted stereo position stops reaching the rendered audio
probe "35 the persisted pan is ignored by the render" \
  src/lib/audio/engine.ts \
  '  if (track.pan !== undefined) channel.pan.value = track.pan;' \
  '  void track.pan;'

# 36 — the metronome is recorded into the exported file
probe "36 the metronome is recorded into the file" \
  src/lib/export/render-wav.ts \
  '        metronomeEnabled: () => false,' \
  '        metronomeEnabled: () => true,'

# 37 — the persisted level stops reaching the rendered audio
probe "37 the persisted volume is ignored by the render" \
  src/lib/audio/engine.ts \
  '  const channel = new tone.Channel({ context, volume: track.volumeDb });' \
  '  const channel = new tone.Channel({ context, volume: 0 });'

# Leave the bundle as the committed sources describe it.
npx vite build --config eval/export/vite.render.config.mts >/dev/null 2>&1

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
