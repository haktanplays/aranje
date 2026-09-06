#!/usr/bin/env bash
#
# Serial mutation probes for the gain parity round (2V-D.2 gain parity §20 C).
#
# Each one breaks exactly one thing in the source, runs the test that is
# supposed to notice, restores the file, and checks the restore actually
# happened by comparing hashes. A probe whose pattern is not in the file is a
# SETUP-FAIL and is never counted as a red; a probe that stays green is a test
# that was not testing anything.
#
# Serial on purpose: these edit the working tree. Never run them beside a
# suite.
set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0; green=0; setup=0; restore_fail=0

VOICE=src/lib/audio/expressive-voice.ts
ENGINE=src/lib/audio/engine.ts
MAP=src/lib/audio/sample-map.ts
PRESETS=src/lib/audio/expression.ts
PLAN=src/lib/audio/expression-plan.ts
TAKE=src/lib/listening/rhythm-take.ts
CLIPS=src/lib/listening/clip-plan.ts
SCOPE=src/lib/listening/listening-scope.ts
AUTH=src/lib/listening/founder-authority.ts

PARITY=src/lib/audio/voice-parity.test.ts
RHYTHM=src/lib/listening/rhythm-take.test.ts
AUTH_SPEC=src/lib/listening/founder-authority.test.ts

probe() {
  local name="$1" file="$2" from="$3" to="$4" spec="$5" pattern="$6"
  local before after
  before=$(sha256sum "$file" | cut -d' ' -f1)
  cp "$file" "$file.probe-bak"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if old not in text:
    print("PROBE-SETUP-FAILED: pattern absent")
    sys.exit(3)
open(path, "w").write(text.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then
    echo "SETUP-FAIL    $name"; setup=$((setup+1)); mv "$file.probe-bak" "$file"; return
  fi
  local out
  out=$(npx vitest run "$spec" -t "$pattern" 2>&1)
  mv "$file.probe-bak" "$file"
  after=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$before" != "$after" ]; then
    echo "RESTORE-FAIL  $name"; restore_fail=$((restore_fail+1)); return
  fi
  if echo "$out" | grep -qE "[1-9][0-9]* failed"; then
    echo "RED           $name"; pass=$((pass+1))
  else
    echo "STAYED-GREEN  $name  <-- the guard does not guard"; green=$((green+1))
  fi
}

# ------------------------------------------- who chooses the recording (§4)

probe "the tie goes back down, so the two paths disagree again" \
  "$MAP" "    const higherOnATie = distance === bestDistance && entry.midi > (best?.midi ?? -Infinity);" \
  "    const higherOnATie = false;" \
  "$PARITY" "agrees with the shared sampler on every semitone of every pack"

probe "the chooser stops looking past the first recording" \
  "$MAP" "    const closer = distance < bestDistance;" "    const closer = best === null;" \
  "$PARITY" "still takes the genuinely nearer recording when there is one"

probe "the tie depends on the order the pack arrives in" \
  "$MAP" "    const higherOnATie = distance === bestDistance && entry.midi > (best?.midi ?? -Infinity);" \
  "    const higherOnATie = distance === bestDistance;" \
  "$PARITY" "breaks a tie upwards whatever order the entries arrive in"

# --------------------------------------------------- normalization (§4, §7)

probe "the shared sampler loses the pack's normalization" \
  "$ENGINE" "        volume: pack.trimDb," "        volume: 0," \
  "$PARITY" "gives the sampler the pack's trim as its volume"

probe "the expressive voice loses the pack's normalization" \
  "$VOICE" "    const level = host.trimGain;
    const gain = new this.tone.Gain({" "    const level = 1;
    const gain = new this.tone.Gain({" \
  "$PARITY" "builds the voice's gain at exactly that"

probe "the trim is converted as if it were a power ratio" \
  "$ENGINE" "        trimGain: Math.pow(10, pack.trimDb / 20)," \
  "        trimGain: Math.pow(10, pack.trimDb / 10)," \
  "$PARITY" "gives the expressive voice the same trim, as a linear factor"

probe "a compensation constant is added to the expressive level" \
  "$VOICE" "      gain: (plan.gainEnvelope[0]?.value ?? plan.gain) * level," \
  "      gain: (plan.gainEnvelope[0]?.value ?? plan.gain) * level * 3.133," \
  "$PARITY" "builds the voice's gain at exactly that"

probe "a shaped note ignores its own envelope" \
  "$VOICE" "      gain: (plan.gainEnvelope[0]?.value ?? plan.gain) * level," \
  "      gain: plan.gain * level," \
  "$PARITY" "reads a shaped note's level off its envelope, still times the trim"

probe "a legato chain forgets the trim" \
  "$VOICE" "      gain: chain.gain * level," "      gain: chain.gain," \
  "$PARITY" "carries the trim through a chain and through a resumed voice too"

probe "a resumed voice comes back at a different level" \
  "$VOICE" "    gain.gain.linearRampToValueAtTime(continuation.currentGain * level, time + fade);" \
  "    gain.gain.linearRampToValueAtTime(continuation.currentGain * level * 3.133, time + fade);" \
  "$PARITY" "carries the trim through a chain and through a resumed voice too"

# ------------------------------------------------------ where things connect

probe "the expressive voice goes straight to the master" \
  "$ENGINE" "      destination: voice.channel," "      destination: master," \
  "$PARITY" "sends both to the track's own channel and nowhere else"

probe "the sampler bypasses the track's channel" \
  "$ENGINE" "      sampler.connect(channel);" "      sampler.connect(master);" \
  "$PARITY" "sends both to the track's own channel and nowhere else"

probe "the track's own volume stops being applied" \
  "$ENGINE" "  const channel = new tone.Channel({ context, volume: track.volumeDb });" \
  "  const channel = new tone.Channel({ context, volume: 0 });" \
  "$PARITY" "keeps the track's own volume on the shared channel"

probe "a second dry path reaches the bus" \
  "$VOICE" "    gain.connect(host.destination);

    let filter: Tone.Filter | null = null;" \
  "    gain.connect(host.destination);
    gain.connect(host.destination);

    let filter: Tone.Filter | null = null;" \
  "$PARITY" "reaches the bus exactly once, through exactly one gain"

probe "the filtered voice keeps a dry copy beside the filter" \
  "$VOICE" "    source.connect(filter ?? gain);" \
  "    source.connect(filter ?? gain);
    if (filter) source.connect(gain);" \
  "$PARITY" "puts a filter in the chain without adding a second path to the bus"

probe "a plain note is struck at the square of its velocity" \
  "$ENGINE" "      sampler.triggerAttackRelease(current.pitch, duration, struck, current.gain);" \
  "      sampler.triggerAttackRelease(current.pitch, duration, struck, current.gain * current.gain);" \
  "$PARITY" "strikes a plain note at the plan's gain, once"

# ------------------------------------------------------- the ordering (§6)

probe "a ghost note comes out louder than a plain one" \
  "$PRESETS" "gainMultiplier: 0.45," "gainMultiplier: 1.45," \
  "$PARITY" "orders the three the way a guitarist would expect"

probe "an accent comes out quieter than a plain note" \
  "$PRESETS" "gainMultiplier: 1.18," "gainMultiplier: 0.8," \
  "$PARITY" "orders the three the way a guitarist would expect"

probe "the declared ratios drift away from the presets" \
  "$PRESETS" "gainMultiplier: 1.18," "gainMultiplier: 1.6," \
  "$PARITY" "keeps the declared ratios rather than a taste"

probe "an attack quietly moves the note's own gain" \
  "$PLAN" "  const gain = velocityGain(onset.velocity);" \
  "  const gain = velocityGain(onset.velocity) * 0.5;" \
  "$PARITY" "leaves the plain note's own gain alone on all three"

probe "a palm mute and an accent multiply twice" \
  "$PLAN" "    const level = round(gain * (attackLayer?.gainScale ?? 1));" \
  "    const level = round(gain * (attackLayer?.gainScale ?? 1) ** 2);" \
  "$PARITY" "scales the muted level by the attack exactly once"

probe "an accented note is quietly put back on the shared path" \
  "$PLAN" "    return {
      ...base,
      expressive: true,
      durationSeconds: composed.durationSeconds," \
  "    return {
      ...base,
      expressive: false,
      durationSeconds: composed.durationSeconds," \
  "$PARITY" "plays accent on the expressive path"

# ------------------------------------------------------- lifecycle (§18)

probe "stopping leaves the voices where they were" \
  "$VOICE" "  stopAll(): void {" "  stopAll(): void {
    if (1 > 0) return;" \
  "$PARITY" "ends with nothing active and everything freed"

probe "disposing a voice leaves its gain in the graph" \
  "$VOICE" "    voice.gain.dispose();" "    void voice.gain;" \
  "$PARITY" "ends with nothing active and everything freed"

# ----------------------------------------------------- the cards (§12–§15)

probe "L33 stops separating its accents from its ghosts" \
  "$TAKE" '    attack: starts.has(index) ? ("accent" as const) : ("ghost" as const),' \
  '    attack: "accent" as const,' \
  "$RHYTHM" "moves only the accents between the two L33 takes"

probe "L33 leans on a metronome again" \
  "$CLIPS" "Vurgular dışında hiçbir şey değişmiyor. Metronom yok." \
  "Vurgular dışında hiçbir şey değişmiyor. Metronomu dinle." \
  "$RHYTHM" "plays each L33 bar twice and schedules no click"

probe "L34 flattens its three strikes into one" \
  "$TAKE" '    hits.push({ slot: start + 1, fret: L34_FRET, attack: "accent" });' \
  "    hits.push({ slot: start + 1, fret: L34_FRET });" \
  "$RHYTHM" "writes plain, accent and ghost in that order, twice"

probe "L34 runs its two groups together with no gap" \
  "$TAKE" "  for (const start of [0, 4]) {" "  for (const start of [0, 3]) {" \
  "$RHYTHM" "leaves a real gap between the two groups"

probe "L34 gives one of the three strikes a level of its own" \
  "$TAKE" "    hits.push({ slot: start, fret: L34_FRET });" \
  "    hits.push({ slot: start, fret: L34_FRET + 5 });" \
  "$RHYTHM" "changes nothing but the striking"

probe "L35 loses the bend it is asking about" \
  "$TAKE" '          gesture: { kind: "bend_release", targetCents: 200 },' "" \
  "$RHYTHM" "really contains a vibrato, a bend and its release, and a slide"

probe "L35 loses the vibrato it is asking about" \
  "$TAKE" '        { slot: 2, fret: L35_LOW, articulation: "vibrato", hold: 1 },' \
  "        { slot: 2, fret: L35_LOW, hold: 1 }," \
  "$RHYTHM" "really contains a vibrato, a bend and its release, and a slide"

probe "L35 loses the slide it is asking about" \
  "$TAKE" '        { slot: 1, fret: L35_HIGH, connection: { kind: "shift_slide" }, hold: 2 },' \
  "        { slot: 1, fret: L35_HIGH, hold: 2 }," \
  "$RHYTHM" "really contains a vibrato, a bend and its release, and a slide"

probe "L35 loses the plain note it is measured against" \
  "$TAKE" "        { slot: 4, fret: L35_LOW, hold: 3 }," \
  '        { slot: 4, fret: L35_LOW, hold: 3, attack: "accent" },' \
  "$RHYTHM" "writes no attack anywhere, so nothing in it is a level change"

probe "L35 wanders out of its register" \
  "$TAKE" "const L35_HIGH = 7;" "const L35_HIGH = 17;" \
  "$RHYTHM" "stays on one string and in one register"

probe "a card shows the founder a number" \
  "$CLIPS" "Vurgulu nota düz notadan daha belirgin, hayalet nota ise daha geride ve doğal duyuluyor mu?" \
  "Vurgulu nota düz notadan 1.18 gain daha belirgin duyuluyor mu?" \
  "$RHYTHM" "asks the founder about loudness in words, and shows no number"

# --------------------------------------------------- founder authority (§10)

probe "L31's refusal is rewritten by the new round" \
  "$AUTH" '    verdict: "fail",' '    verdict: "pass",' \
  "$AUTH_SPEC" "keeps L31 refuted whatever the next card scores"

probe "an archived card is put back in front of the founder" \
  "$SCOPE" 'export const ACTIVE_CLIP_IDS = ["L33", "L34", "L35"] as const;' \
  'export const ACTIVE_CLIP_IDS = ["L26", "L33", "L34", "L35"] as const;' \
  "$AUTH_SPEC" "never asks a card whose answer is already recorded"

echo
echo "probes: $pass red, $green stayed green, $setup setup failures, $restore_fail restore failures"
