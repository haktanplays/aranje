#!/usr/bin/env bash
# 2S-A vacuity probes that only a rendered buffer can judge (§17).
#
# Six claims about the audio cannot be broken by a DOM assertion or by a mock:
# that a landing finger fits the note it lands on, that the pitch it lands on
# is really sounded, that every onset of a dense bar is really audible, and
# that a pull-off stays one strike. Each mutation is measured the way the claim
# is — rebuild the render bundle, render offline at a real tempo, read the
# fundamental and the difference off the samples — and the check is asserted to
# go red.
#
#   npx vite build --config eval/intent-composer/vite.intent.config.mts
#   ./eval/chord-audio/serve.sh
#   ./eval/intent-composer/audio-probes.sh
set -u

pass=0; fail=0; skipped=0
CHECK="node --experimental-strip-types eval/intent-composer/check-audio.mjs"
BUILD="npx vite build --config eval/intent-composer/vite.intent.config.mts"

probe() {
  local name="$1" file="$2" find="$3" repl="$4"
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
  if [ $? -ne 0 ]; then
    echo "SKIP  $name (anchor)"; mv "$file.probebak" "$file"
    skipped=$((skipped+1)); return
  fi

  if $BUILD >/dev/null 2>&1; then
    if $CHECK >/tmp/aranje-intent-audio.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-intent-audio.log) iddia)"
      pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (bundle build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# A1 — the constant travel time comes back, which is the defect itself
probe "A1 a landing finger takes the same time however short the note is" \
  src/lib/audio/legato-chain.ts \
  '  if (availableSeconds === undefined) return wanted;' \
  '  if (availableSeconds === undefined) return wanted;
  return wanted;'

# A2 — the whole note may be spent travelling, so nothing is left to hear
probe "A2 the travel may take the whole of the note it lands on" \
  src/lib/audio/expression.ts \
  '    maxTravelFraction: 0.4,' \
  '    maxTravelFraction: 1,'

# A3 — the room is read off the wrong note
probe "A3 the room is measured on the note the finger leaves" \
  src/lib/audio/legato-chain.ts \
  '      const targetRoom = durationSeconds(tempo, onset.timeTicks, onset.durationTicks);' \
  '      const targetRoom = durationSeconds(tempo, 0, onset.timeTicks);'

# A4 — the target pitch is never actually set, so the glide never lands
probe "A4 the chain never sets the pitch it is travelling to" \
  src/lib/audio/legato-chain.ts \
  '      arrivesAt =
        targetAt + transitionSeconds(decision.transition, timeScale, targetRoom);' \
  '      arrivesAt = targetAt + 1;'

# A5 — a repeated pitch is dropped as "inaudible": one of the eight shortcuts
# §3 forbids, and the one the reported defect would have looked like.
probe "A5 a repeated pitch is dropped as inaudible" \
  src/lib/audio/expression-plan.ts \
  '    const onsets = trackLegatoOnsets(song, track.id);' \
  '    const onsets = trackLegatoOnsets(song, track.id).filter(
      (entry, index, all) => index === 0 || all[index - 1]?.pitch !== entry.pitch,
    );'

# A6 — the slur is quietly turned into an ordinary attack, which would make a
# 1/32 pull-off "work" by no longer being a pull-off. §3 forbids exactly this.
probe "A6 a pull-off is played as an ordinary second attack" \
  src/lib/audio/legato-chain.ts \
  '  const articulation = onset.articulation;' \
  '  const articulation = "normal" as typeof onset.articulation;'

# Leave the bundle as the committed sources describe it. Without this last
# clean build the file on disk is the *last mutation's* audio.
$BUILD >/dev/null 2>&1

echo
echo "$pass red, $fail vacuous, $skipped skipped"
exit $(( fail > 0 ? 1 : 0 ))
