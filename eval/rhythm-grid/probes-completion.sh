#!/usr/bin/env bash
#
# Serial mutation probes for the D.2 completion round (§19).
#
# Same contract as `probes.sh`: break exactly one thing, run the test that is
# supposed to notice, restore, and check the restore by hash. A probe that
# stays green is a guard that does not guard, and it is reported as a failure
# of this round rather than tidied away.
#
# Serial on purpose — these edit the working tree. Never run them beside a
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

TAKE=src/lib/listening/rhythm-take.ts
AUTH=src/lib/listening/founder-authority.ts
SCOPE=src/lib/listening/listening-scope.ts
CLIPS=src/lib/listening/clip-plan.ts
DETAIL=src/lib/music/metronome-detail.ts
ENGINE=src/lib/audio/engine.ts
COUNTIN=src/lib/practice/count-in.ts
POSITION=src/lib/audio/position.ts
PLAYBACK=src/lib/audio/playback.ts
DOCK=src/components/workspace/EditorDock.tsx
PANEL=src/components/workspace/shelf/MeterPanel.tsx

TAKE_SPEC=src/lib/listening/rhythm-take.test.ts
AUTH_SPEC=src/lib/listening/founder-authority.test.ts
DETAIL_SPEC=src/lib/music/metronome-detail.test.ts
TYPO_SPEC=src/lib/workspace/rhythm-surface.test.ts

# ------------------------------------------------ the L33 fixture (§19 a-i)

probe "L33 gives both takes the same accent positions" \
  "$TAKE" '    attack: starts.has(index) ? ("accent" as const) : ("ghost" as const),' \
  '    attack: index % 2 === 0 ? ("accent" as const) : ("ghost" as const),' \
  "$TAKE_SPEC" "moves only the accents between the two"

probe "the grouping produces the wrong ticks" \
  "$TAKE" "    starts.add(at);
    at += group;" \
  "    starts.add(at);
    at += group + 1;" \
  "$TAKE_SPEC" "accents the group starts, and they differ between the takes"

probe "L33's unaccented eighths lose their attack" \
  "$TAKE" '    attack: starts.has(index) ? ("accent" as const) : ("ghost" as const),' \
  '    ...(starts.has(index) ? { attack: "accent" as const } : {}),' \
  "$TAKE_SPEC" "authors every L33 eighth"

probe "L33 goes back to a moving pitch contour" \
  "$TAKE" "    fret: L33_FRET," "    fret: L33_FRET + (index % 3)," \
  "$TAKE_SPEC" "gives L33 one pitch"

probe "L33 plays its bar only once" \
  "$TAKE" "  const evened = appendBars(song, trackId, [
    accentedRiffBar([2, 2, 3]),
    accentedRiffBar([2, 2, 3]),
  ]);" \
  "  const evened = appendBars(song, trackId, [accentedRiffBar([2, 2, 3])]);" \
  "$TAKE_SPEC" "plays each L33 bar twice"

probe "the two L33 takes get different accent counts" \
  "$TAKE" "  const uneven = appendBars(song, trackId, [
    accentedRiffBar([3, 2, 2]),
    accentedRiffBar([3, 2, 2]),
  ]);" \
  "  const uneven = appendBars(song, trackId, [
    accentedRiffBar([3, 2, 2, 1]),
    accentedRiffBar([3, 2, 2, 1]),
  ]);" \
  "$TAKE_SPEC" "authors every L33 eighth"

probe "L33's card turns the metronome back on in its text" \
  "$CLIPS" '          "Tek nota, yedi sekizlik, iki tur. Vurgular dışında hiçbir şey değişmiyor. Metronom yok.",' \
  '          "Tek nota, yedi sekizlik, iki tur. Metronom açık.",' \
  "$TAKE_SPEC" "plays each L33 bar twice"

probe "L33 asks the founder to press something" \
  "$CLIPS" '          "Bu kez iki tekrar belirgin biçimde farklı yerlerden gruplanmış gibi duyuluyor mu?",' \
  '          "Ölçüyü seç ve iki tekrarı karşılaştır.",' \
  "$TAKE_SPEC" "asks the founder to listen and never to edit"

probe "L33's takes are wired to the wrong songs" \
  "$TAKE" "    L33b: take(uneven, [accentedRiffBar([3, 2, 2]), accentedRiffBar([3, 2, 2])])," \
  "    L33b: take(evened, [accentedRiffBar([2, 2, 3]), accentedRiffBar([2, 2, 3])])," \
  "$TAKE_SPEC" "moves only the accents between the two"

# ------------------------------------------- the archive may not be rewritten

probe "L31's refutation is softened to inconclusive" \
  "$AUTH" '    verdict: "fail",' '    verdict: "inconclusive",' \
  "$AUTH_SPEC" "records the rhythm round"

probe "L31's sentence is paraphrased" \
  "$AUTH" '    note: "İkisi arasında belirgin bir fark yok",' \
  '    note: "Fark küçüktü",' \
  "$AUTH_SPEC" "records the rhythm round"

probe "L31 is written over by the new card" \
  "$AUTH" '    id: "L31",' '    id: "L33",' \
  "$AUTH_SPEC" "keeps L31 refuted whatever the next card scores"

probe "L30 and L32 are asked again" \
  "$SCOPE" 'export const ACTIVE_CLIP_IDS = ["L33", "L34", "L35"] as const;' \
  'export const ACTIVE_CLIP_IDS = ["L30", "L31", "L32", "L33", "L34", "L35"] as const;' \
  "$AUTH_SPEC" "never asks a card whose answer is already recorded"

probe "the round asks nothing at all" \
  "$SCOPE" 'export const ACTIVE_CLIP_IDS = ["L33", "L34", "L35"] as const;' \
  'export const ACTIVE_CLIP_IDS = ["L30"] as const;' \
  "$AUTH_SPEC" "asks the three cards of the gain parity round and no others"

probe "an archived card is quietly dropped from the record" \
  "$AUTH" '  { id: "L30", title: "6/8 içinde hızlı üçleme", verdict: "pass" },' "" \
  "$AUTH_SPEC" "holds every card the founder has judged"

probe "the fail verdict loses its own label" \
  "$AUTH" '  fail: "Olmamış",' '  fail: "Olmuş",' \
  src/lib/listening/listening-pack.test.ts "lets no session answer overwrite"

# ---------------------------------------------- the Pro click (§19 j-t)

probe "both click settings are given the same name" \
  "$DETAIL" '  units: "Tüm sekizlikleri duy",' '  units: "Yalnız ana vuruşlar",' \
  "$DETAIL_SPEC" "offers two settings and names them"

probe "the click labels speak in model words" \
  "$DETAIL" '  units: "Tüm sekizlikleri duy",' '  units: "Subdivision click",' \
  "$DETAIL_SPEC" "offers two settings and names them"

probe "4/4 is promised a difference it does not have" \
  "$DETAIL" "  if (units <= beats) return null;" "  if (units < 0) return null;" \
  "$DETAIL_SPEC" "promises nothing extra when the beats already are the units"

probe "the 7/8 sentence stops naming the group starts" \
  "$DETAIL" 'return `Grup başları daha güçlü, diğer ${unitName(input.meter)} daha hafif çalar.`;' \
  'return "Alt bölünme açık.";' \
  "$DETAIL_SPEC" "explains 7/8 in the vocabulary the panel already uses"

probe "the schedule is filtered instead of the click" \
  "$ENGINE" "metronomeClicks(engine.plan, { subdivisions: true })" \
  "metronomeClicks(engine.plan, { subdivisions: options.metronomeSubdivisions?.() })" \
  "$DETAIL_SPEC" "schedules every pulse, whatever the reader currently wants"

probe "the subdivision gate leaves the callback" \
  "$ENGINE" '      if (beat.strength === "subdivision" && !options.metronomeSubdivisions?.()) return;' \
  "" \
  "$DETAIL_SPEC" "decides inside the callback"

probe "a fine click is scheduled twice on one tick" \
  "$POSITION" "    for (const position of positions) {" \
  "    for (const position of [...positions, ...positions]) {" \
  "$DETAIL_SPEC" "schedules every notated unit and never two clicks on one"

probe "turning the fine clicks on re-strengths a main beat" \
  src/lib/music/meter-beats.ts '      strength: start ?? "subdivision",' \
  '      strength: "subdivision",' \
  "$DETAIL_SPEC" "leaves the main beats on their own ticks"

probe "the three click levels are flattened to two" \
  "$POSITION" "  subdivision: 0.28," "  subdivision: 0.55," \
  "$DETAIL_SPEC" "keeps downbeat, group start and fine click three different"

probe "the fine click is silent" \
  "$POSITION" "  subdivision: 0.28," "  subdivision: 0," \
  "$DETAIL_SPEC" "keeps downbeat, group start and fine click three different"

probe "the count-in ignores the reader's setting" \
  "$COUNTIN" "  const pulses = input.subdivisions" "  const pulses = false" \
  "$DETAIL_SPEC" "counts seven when the click counts seven"

probe "the count-in counts every unit as its own beat" \
  "$COUNTIN" '      if (beat.strength !== "subdivision") counted += 1;' "      counted += 1;" \
  "$DETAIL_SPEC" "counts seven when the click counts seven"

probe "the count-in flattens its own levels" \
  "$COUNTIN" "        strength: beat.strength," '        strength: "downbeat",' \
  "$DETAIL_SPEC" "counts three when the click counts three"

probe "the count-in stops ending at the first tick" \
  "$COUNTIN" "        beforeSeconds: (totalTicks - offset) * secondsPerTick," \
  "        beforeSeconds: (totalTicks - offset) * secondsPerTick + 0.25," \
  "$DETAIL_SPEC" "ends every count-in exactly at the first tick"

probe "the click setting is written into the Song" \
  "$PLAYBACK" "  setMetronomeSubdivisions(on: boolean): void {
    this.set({ metronomeSubdivisions: on });" \
  "  setMetronomeSubdivisions(on: boolean): void {
    this.song = { ...this.song, bpm: this.song.bpm + (on ? 1 : 0) };
    this.set({ metronomeSubdivisions: on });" \
  "$DETAIL_SPEC" "sets session state and writes no song"

# --------------------------------------------------- the label §13 asks about

probe "the duration panel's label picks up the typo" \
  src/lib/workspace/shelf-panel.ts '    label: "Nota süresi",' '    label: "Nato süresi",' \
  "$TYPO_SPEC" "never writes the note-length label as"

probe "the dock's own note about the label picks up the typo" \
  "$DOCK" 'No `min-w-0` here: it let "Nota süresi" be laid out 3px' \
  'No `min-w-0` here: it let "Nato süresi" be laid out 3px' \
  "$TYPO_SPEC" "never writes the note-length label as"

probe "the rhythm mark for note length picks up the typo" \
  src/lib/tab/rhythm-marks.ts '{ id: "note_stem", rank: 3, label: "Nota süresi", minZoom: null, overlay: false }' \
  '{ id: "note_stem", rank: 3, label: "Nato süresi", minZoom: null, overlay: false }' \
  "$TYPO_SPEC" "never writes the note-length label as"

# ------------------------------------------------- the panel that offers it

probe "the click row leaves the Pro area" \
  "$PANEL" '          <ShelfRow label="Metronom" testId="meter-click">' \
  '          <ShelfRow label="Metronom" testId="meter-click-moved">' \
  src/lib/workspace/rhythm-surface.test.ts "offers the click settings in Pro"

probe "the panel writes the click choice through the metre draft" \
  "$PANEL" "                onPress={() => click.onDetail(detail)}" \
  "                onPress={() => onDraft({ ...shown })}" \
  src/lib/workspace/rhythm-surface.test.ts "changes only the listener's setting"

echo
echo "completion probes: $pass red, $fail not red, $restore_fail restore failures"
[ "$fail" -eq 0 ] && [ "$restore_fail" -eq 0 ]
