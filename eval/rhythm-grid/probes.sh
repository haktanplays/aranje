#!/usr/bin/env bash
#
# Serial mutation probes for the rhythm round (2V-D.2 c3 §18).
#
# Each one breaks exactly one thing in the source, runs the test that is
# supposed to notice, restores the file, and then checks the restore actually
# happened by comparing hashes. A probe that stays green is a test that was
# not testing anything; a probe that restores badly poisons every probe after
# it, which is why the hash gate is here rather than in a comment.
#
# Serial on purpose: these edit the working tree. Never run them beside a
# suite.
set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0; fail=0; restore_fail=0

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
    echo "SETUP-FAIL    $name"; fail=$((fail+1)); mv "$file.probe-bak" "$file"; return
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
    echo "STAYED-GREEN  $name  <-- the guard does not guard"; fail=$((fail+1))
  fi
}

# ---------------------------------------------- barTicks authority (§18 a, b)

probe "barTicks stops asking the authority" \
  src/lib/music/timing.ts "  return ticksPerBar(bar.timeSignature, bar.resolution);" \
  "  return bar.resolution * 12;" \
  src/lib/export/meter-export-audit.test.ts "gives each bar the length its own metre says"

probe "a caller open-codes bar length again" \
  src/lib/song/sounding.ts "    at += barTicks(bar);" \
  "    at += slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution);" \
  src/lib/music/timing-authority.test.ts "asks the authority in every module"

probe "the authority stops multiplying" \
  src/lib/music/timing.ts "  return slotCount(timeSignature, resolution) * ticksPerSlot(resolution);" \
  "  return 768;" \
  src/lib/music/timing-authority.test.ts "leaves exactly one module"

probe "the preview computes its own bar length" \
  src/lib/song/timing-change.ts "  return ticksPerBar(timeSignature, resolution);" \
  "  return 768;" \
  src/lib/song/meter-change-preview.test.ts "says the bar length is unchanged"

# ------------------------------------------------ beat / pulse layers (§18 c)

probe "a subdivision is called a main beat" \
  src/lib/music/meter-beats.ts '      strength: start ?? "subdivision",' \
  '      strength: start ?? "secondary",' \
  src/lib/music/meter-beats.test.ts "keeps every note value of the metre"

probe "the pulse list loses the metre's own note values" \
  src/lib/music/meter-beats.ts "  for (let slot = 0; slot < total; slot += perUnit) {" \
  "  for (let slot = 0; slot < total; slot += perUnit * 2) {" \
  src/lib/music/meter-beats.test.ts "starts a main beat exactly where"

probe "beats and pulses stop agreeing on where a beat starts" \
  src/lib/music/meter-beats.ts "  const beatStart = new Map(beats.map((beat) => [beat.slot, beat.strength]));" \
  "  const beatStart = new Map(beats.map((beat) => [beat.slot + 1, beat.strength]));" \
  src/lib/music/meter-beats.test.ts "starts a main beat exactly where"

probe "a bar grows a second downbeat" \
  src/lib/music/meter-beats.ts '      strength: index === 0 ? "downbeat" : "secondary",' \
  '      strength: index <= 1 ? "downbeat" : "secondary",' \
  src/lib/music/meter-beats.test.ts "sums to the bar's slot count"

# --------------------------------------------------- 6/8 and grouping (§18 d)

probe "6/8 is counted in six" \
  src/lib/music/rhythm-profile.ts '  "6/8": [' '  "6/8x": [' \
  src/lib/music/meter-beats.test.ts "names every metre in the contract"

probe "the 6/8 default feel becomes three groups of two" \
  src/lib/music/rhythm-profile.ts '  "6/8": [
    [3, 3],' '  "6/8": [
    [2, 2, 2],' \
  src/lib/music/rhythm-language.test.ts "adds no subdivision line"

probe "7/8 defaults back to seven single eighths" \
  src/lib/music/rhythm-profile.ts "  return groupingPresets(meter)[0]!;" \
  "  return evenGrouping(meter);" \
  src/lib/music/timing-authority.test.ts "now defaults to a feel a guitarist"

probe "a grouping that does not fill the bar is accepted" \
  src/lib/music/meter-beats.ts "  if (total !== meter[0]) {" "  if (total < 0) {" \
  src/lib/music/meter-beats.test.ts "refuses a grouping whose sum"

probe "the schema stops refusing a bad grouping" \
  src/lib/song/schema.ts "      if (total !== bar.timeSignature[0]) {" "      if (total < 0) {" \
  src/lib/song/schema.test.ts "refuses a grouping that does not add up"

# ------------------------------------------------ metronome accents (§18 e, f)

probe "the 7/8 accent lands on the wrong eighth" \
  src/lib/audio/position.ts "        time: bar.time + position.slot * step," \
  "        time: bar.time + position.slot * step + 1," \
  src/lib/audio/position.test.ts "clicks a 7/8 three times"

probe "Pro subdivisions move the main beats" \
  src/lib/audio/position.ts "      ? meterPulses({" "      ? meterBeats({" \
  src/lib/audio/position.test.ts "clicks all seven eighths"

probe "every click gets the same loudness" \
  src/lib/audio/position.ts "  subdivision: 0.28," "  subdivision: 1," \
  src/lib/audio/position.test.ts "gives each level its own loudness"

probe "the downbeat stops being the loudest" \
  src/lib/audio/position.ts "  downbeat: 1," "  downbeat: 0.4," \
  src/lib/audio/position.test.ts "gives each level its own loudness"

probe "the metronome reads the scalar again" \
  src/lib/audio/position.ts "    grouping: bar.grouping," "    grouping: undefined," \
  src/lib/audio/position.test.ts "clicks a 7/8 three times"

# --------------------------------------------- rhythm vocabulary (§18 g, h)

probe "grid and note length share a word" \
  src/lib/music/rhythm-vocabulary.ts 'label: "Nota süresi"' 'label: "Grid"' \
  src/lib/music/rhythm-vocabulary.test.ts "never lets grid, metre and note length"

probe "zoom claims to be a musical edit" \
  src/lib/music/rhythm-vocabulary.ts 'return rhythmConcept(id).owner !== "view";' \
  "return true;" \
  src/lib/music/rhythm-vocabulary.test.ts "owns nothing in the song"

probe "the denser-bar promise stops promising" \
  src/lib/music/rhythm-vocabulary.ts "süresi değişmeyecek." "süresi de değişecek." \
  src/lib/music/rhythm-vocabulary.test.ts "carries the sentence a denser bar"

probe "the duration panel is renamed to the chord's word" \
  src/lib/workspace/shelf-panel.ts 'label: "Nota süresi",' 'label: "Süre",' \
  src/lib/workspace/rhythm-surface.test.ts "names the metre panel and the duration"

probe "the ring question is replaced by a note value" \
  src/lib/workspace/shelf-panel.ts 'hint: "Ne kadar çınlasın?",' 'hint: "1/4",' \
  src/lib/workspace/rhythm-surface.test.ts "asks the ring question"

# ----------------------------------------------- the duration language (§7/§8)

probe "one beat is hardcoded to a quarter" \
  src/lib/music/ring-language.ts "  return first.slots * ticksPerSlot(context.resolution);" \
  "  return 192;" \
  src/lib/music/ring-language.test.ts "calls one beat a dotted quarter"

probe "a fraction reaches the first line" \
  src/lib/music/ring-language.ts 'label: "Bir ana vuruş", ticks: beat }' \
  'label: "1/4", ticks: beat }' \
  src/lib/music/ring-language.test.ts "never puts a fraction on the first line"

probe "a length with no name invents one" \
  src/lib/music/ring-language.ts "  return value ? valueLabel(value) : null;" \
  '  return value ? valueLabel(value) : "beşlik";' \
  src/lib/music/ring-language.test.ts "names a length only when it has a name"

probe "a technique reaches the ring picker" \
  src/lib/music/ring-language.ts '{ id: "one_beat", label: "Bir ana vuruş", ticks: beat }' \
  '{ id: "one_beat", label: "Bir ana vuruş slide", ticks: beat }' \
  src/lib/music/ring-language.test.ts "keeps every technique out of the ring picker"

probe "the spacing question is promoted to the first surface" \
  src/lib/music/ring-language.ts '    question: "Sonraki nota ne zaman gelsin?",
    hint: "Normalde bu notanın süresi kadar sonra. Değiştirmek isteğe bağlı.",
    primary: false,' \
  '    question: "Sonraki nota ne zaman gelsin?",
    hint: "Normalde bu notanın süresi kadar sonra. Değiştirmek isteğe bağlı.",
    primary: true,' \
  src/lib/music/ring-language.test.ts "lists exactly three"

# ---------------------------------------- the reading of what is in the bar

probe "three main beats stand for the whole bar" \
  src/lib/music/rhythm-language.ts "      : \`\${unitCount} \${unitName} · \${groupingLabel(feel)}\`;" \
  "      : null;" \
  src/lib/music/rhythm-language.test.ts "never lets three main beats stand"

probe "the subdivision line is shown where it says nothing" \
  src/lib/music/rhythm-language.ts "    unitCount === count" "    unitCount === -1" \
  src/lib/music/rhythm-language.test.ts "adds no subdivision line"

# ------------------------------------------------------ Simple / Pro (§5, §6)

probe "Pro opens a metre the format cannot store" \
  src/lib/music/rhythm-modes.ts "      if (!inContract(numerator, denominator)) {" \
  "      if (false) {" \
  src/lib/music/rhythm-modes.test.ts "opens only what the format can actually store"

probe "a closed option stops saying why" \
  src/lib/music/rhythm-modes.ts '          reason: "Bu ölçü henüz proje biçiminde saklanamıyor.",' \
  "          reason: null," \
  src/lib/music/rhythm-modes.test.ts "closes the rest with a reason"

probe "Simple starts naming resolutions" \
  src/lib/music/rhythm-modes.ts 'hint: "En yaygın his. Dört ana vuruş, eşit.",' \
  'hint: "1/16 çözünürlük.",' \
  src/lib/music/rhythm-modes.test.ts "says nothing about resolution"

probe "the panel decides availability itself" \
  src/components/workspace/shelf/FastSequencePanel.tsx "rhythmAvailability" "STORED_RESOLUTIONS; rhythmAvailability" \
  src/lib/music/rhythm-vocabulary.test.ts "leaves no component deciding for itself"

# ------------------------------------------- meter change and downstream (§14)

probe "a full bar is silently truncated" \
  src/lib/song/meter-change-preview.ts 'content_exceeds_new_measure: "Sondaki notalar yeni ölçüye sığmıyor.",' \
  'content_exceeds_new_measure: "Sığdırıldı.",' \
  src/lib/song/meter-change-preview.test.ts "gives the refusal the brief asks for"

probe "the preview reports a fit it did not get" \
  src/lib/song/meter-change-preview.ts "  if (!result.ok) {" "  if (false) {" \
  src/lib/song/meter-change-preview.test.ts "gives the refusal the brief asks for"

probe "a phrase is left behind when the bar line moves" \
  src/lib/song/timing-change.ts "  const phrases = section.phrases ? remapAll(section.phrases, before, after) : null;" \
  "  const phrases = section.phrases ? [...section.phrases] : null;" \
  src/lib/song/timeline-transform.test.ts "moves a phrase over a later bar"

probe "a technique span is left behind" \
  src/lib/song/timing-change.ts "    ? remapAll(section.techniqueSpans, before, after)" \
  "    ? [...section.techniqueSpans]" \
  src/lib/song/timeline-transform.test.ts "moves a phrase over a later bar"

probe "an endpoint the shorter bar cannot hold is clamped" \
  src/lib/song/timeline-transform.ts '        return { ok: false, reason: "offset_beyond_new_bar" };' \
  "        return { ok: true, ticks: next.startTicks + next.lengthTicks - 1 };" \
  src/lib/song/timeline-transform.test.ts "refuses an offset the shorter bar"

probe "half the phrases move and half do not" \
  src/lib/song/timing-change.ts '    if (!result.ok) return "refused";' \
  "    if (!result.ok) continue;" \
  src/lib/song/timeline-transform.test.ts "changes nothing at all when a phrase"

# ------------------------------------------------------------- export (§8–§11)

probe "the MIDI denominator is written as itself" \
  src/lib/export/midi-writer.ts "      return [0xff, 0x58, 0x04, event.numerator, power, 24, 8];" \
  "      return [0xff, 0x58, 0x04, event.numerator, event.denominator, 24, 8];" \
  src/lib/export/meter-export-audit.test.ts "encodes the denominator as its power"

probe "the meter event lands on the wrong tick" \
  src/lib/export/midi-writer.ts "      return [0xff, 0x58, 0x04, event.numerator, power, 24, 8];" \
  "      return [0xff, 0x58, 0x04, event.numerator + 1, power, 24, 8];" \
  src/lib/export/meter-export-audit.test.ts "writes one time-signature event per metre"

probe "MIDI emits a metre change where only the feel changed" \
  src/lib/export/midi-plan.ts '    const key = `${bar.timeSignature[0]}/${bar.timeSignature[1]}`;' \
  '    const key = `${bar.timeSignature[0]}/${bar.timeSignature[1]}/${String(bar.grouping)}`;' \
  src/lib/export/meter-export-audit.test.ts "does not pretend the grouping survived"

probe "the disclosure stops mentioning the grouping" \
  src/lib/export/export-messages.ts "2+2+3 gibi vurgu grupları bazı uygulamalarda " "Her şey " \
  src/lib/export/meter-export-audit.test.ts "says out loud that the grouping may not travel"

probe "the tempo event drifts off the quarter" \
  src/lib/export/midi-plan.ts "export function microsecondsPerQuarter(bpm: number): number {" \
  "export function microsecondsPerQuarter(bpm: number): number { if (bpm > 0) return 500000;" \
  src/lib/export/meter-export-audit.test.ts "not the fixture"

probe "the project file drops the grouping" \
  src/lib/song/schema.ts "    grouping: z.array(z.number().int().min(1)).min(1).optional()," \
  "" \
  src/lib/export/meter-export-audit.test.ts "round-trips every metre with its feel intact"

probe "a bar starts before the one before it ended" \
  src/lib/audio/schedule.ts "      time += durationTicks;" "      time += durationTicks - 1;" \
  src/lib/export/meter-export-audit.test.ts "starts every bar exactly where"

probe "the tail is counted as notated music" \
  src/lib/export/export-plan.ts "    notatedSeconds," "    notatedSeconds: notatedSeconds + tailSeconds," \
  src/lib/export/meter-export-audit.test.ts "ends the notated render on the last bar line"

# ------------------------------------------------------- the listening cards

probe "L31's two takes become byte-identical" \
  src/lib/listening/rhythm-take.ts '    ...(starts.has(index) ? { attack: "accent" as const } : {}),' \
  '    ...{ attack: "accent" as const },' \
  src/lib/listening/rhythm-take.test.ts "accents the group starts"

probe "L31 leans on a metronome instead of the notes" \
  src/lib/listening/clip-plan.ts "Metronom yok." "Metronomu dinle." \
  src/lib/listening/rhythm-take.test.ts "makes the difference audible without a single click"

probe "L32 uses two bars in the same metre" \
  src/lib/listening/rhythm-take.ts "      meter: [6, 8]," "      meter: [7, 8]," \
  src/lib/listening/rhythm-take.test.ts "listens to two bars in different metres"

probe "L32 loses the sound that crosses the line" \
  src/lib/listening/rhythm-take.ts '        { slot: 4, fret: 9, attack: "accent", hold: 2 },' \
  '        { slot: 4, fret: 9, attack: "accent" },' \
  src/lib/listening/rhythm-take.test.ts "carries a sounding note up to the bar line"

probe "L30's triplet run stops landing on exact ticks" \
  src/lib/listening/rhythm-take.ts "    hits.push({ slot: 18 + index * 2, fret: index % 2 === 0 ? 7 : 5, hold: 1 });" \
  "    hits.push({ slot: 19 + index * 2, fret: index % 2 === 0 ? 7 : 5, hold: 1 });" \
  src/lib/listening/rhythm-take.test.ts "puts the straight eighths and the triplets"

probe "L30 plays its bar only once" \
  src/lib/listening/clip-plan.ts 'segments: [plain(rhythmWindow("L30a"), 0.8), plain(rhythmWindow("L30a"), 1.5)],' \
  'segments: [plain(rhythmWindow("L30a"), 1.5)],' \
  src/lib/listening/rhythm-take.test.ts "plays the same bar twice"

probe "the round re-asks a card the founder already decided" \
  src/lib/listening/listening-scope.ts 'export const ACTIVE_CLIP_IDS = ["L33", "L34", "L35"] as const;' \
  'export const ACTIVE_CLIP_IDS = ["L27", "L33", "L34", "L35"] as const;' \
  src/lib/listening/founder-authority.test.ts "never asks a card whose answer is already recorded"

probe "an older card is rewritten to a pass" \
  src/lib/listening/founder-authority.ts '    id: "L21",
    title: "Vurarak slide handoff",
    verdict: "inconclusive",' '    id: "L21",
    title: "Vurarak slide handoff",
    verdict: "pass",' \
  src/lib/listening/founder-authority.test.ts "lets no card of this round rewrite"

probe "a card asks the founder to edit rather than to listen" \
  src/lib/listening/clip-plan.ts '"6/8'"'"'in iki ana vuruş hissi korunurken hızlı dizi doğal biçimde araya yerleşiyor mu?"' \
  '"Ölçüyü seç ve dinle."' \
  src/lib/listening/rhythm-take.test.ts "asks the founder to listen and never to edit"

# ------------------------------------------------------------ the flake gate

probe "the winner is no longer checked for being in flight" \
  src/lib/copilot/budget-race.test.ts "  return !settled;" "  return true;" \
  src/lib/copilot/budget-race.test.ts "holds one call open"

probe "the barrier stops holding the winner" \
  src/lib/copilot/budget-race.test.ts "  const { deps, adapter } = oneBudget(rounds(2), () => barrier.wait);

    const [a, b] = pair(deps);" \
  "  const { deps, adapter } = oneBudget(rounds(2), () => Promise.resolve());

    const [a, b] = pair(deps);" \
  src/lib/copilot/budget-race.test.ts "holds one call open"

echo
echo "probes: $pass red, $fail not red, $restore_fail restore failures"
[ "$fail" -eq 0 ] && [ "$restore_fail" -eq 0 ]
