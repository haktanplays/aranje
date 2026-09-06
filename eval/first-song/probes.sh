#!/usr/bin/env bash
#
# Serial mutation probes for the First Song Product Loop (2V-E.1 §31).
#
# Each probe breaks exactly one thing in the source, runs the named test that
# is supposed to notice, restores the file, and checks the restore happened by
# comparing hashes. A probe that stays green is a test that was not testing
# anything, and it is reported as a failure of the *guard* rather than
# quietly counted as a pass.
#
# Two ways a probe can be broken rather than informative, and both are counted
# apart from the reds:
#
# - **SETUP-FAIL**: the source pattern this probe aims at is not in the file
#   any more, so nothing was mutated.
# - **NO-TEST-MATCHED**: the `-t` filter named a test that does not exist.
#   `vitest -t` with no match exits 0, so without this check a probe aimed at
#   a misspelled test name reports as a *passing guard* — the exact failure
#   mode these probes exist to catch, wearing the probes' own uniform. The
#   first run of this file had twenty-four of them.
#
# Serial on purpose: these edit the working tree. Never run beside a suite.
set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0; green=0; setup=0; nomatch=0; restore_fail=0

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
  if ! echo "$out" | grep -qE "Tests +[1-9]"; then
    echo "NO-TEST-MATCHED  $name  <-- \"$pattern\" names no test"
    nomatch=$((nomatch+1)); return
  fi
  if echo "$out" | grep -qE "[1-9][0-9]* failed"; then
    echo "RED           $name"; pass=$((pass+1))
  else
    echo "STAYED-GREEN  $name  <-- the guard does not guard"; green=$((green+1))
  fi
}

OV=src/lib/workspace/opening-view.ts
OVT=src/lib/workspace/opening-view.test.ts
SL=src/lib/song/section-lifecycle.ts
SLT=src/lib/song/section-length.test.ts
IDS=src/lib/song/lifecycle-ids.ts
LAB=src/lib/instruments/labels.ts
TNT=src/lib/song/track-naming.test.ts
LIM=src/lib/limits.ts
FP=src/lib/projects/project-commands.ts
FPT=src/lib/projects/first-project.test.ts
MIG=src/lib/projects/project-migration.ts
SES=src/lib/projects/project-session.ts
SUM=src/lib/projects/project-summary.ts
FS=src/lib/home/first-song.ts
HM=src/lib/home/home-model.ts
SS=src/lib/home/save-status.ts
NAV=src/lib/workspace/use-workspace-navigation.ts
FA=src/lib/listening/founder-authority.ts
SCOPE=src/lib/listening/listening-scope.ts

echo "== Opening view (§8)"

probe "the untouched song opens on the arrangement again" \
  "$OV" '  return isUntouched(song) ? "tab" : "arrange";' \
  '  return "arrange";' \
  "$OVT" "opens on the tab, where writing happens"

probe "a written song stops opening on the arrangement" \
  "$OV" '  return isUntouched(song) ? "tab" : "arrange";' \
  '  return "tab";' \
  "$OVT" "opens on the arrangement, which is what 13.10 asked for"

probe "emptiness is decided by row length rather than by content" \
  "$OV" '          if (slot === null) continue;' \
  '          return false;' \
  "$OVT" "is untouched however many empty bars and tracks it has"

probe "a tie stops counting as sound" \
  "$OV" '          if (slot === "-") return false;' \
  '          if (slot === "-") continue;' \
  "$OVT" "counts a tie as sound, because it carries one"

probe "a drum hit stops counting" \
  "$OV" '            if (slot.length > 0) return false;' \
  '            continue;' \
  "$OVT" "counts a drum hit, so the rule is not about guitars"

probe "a rest starts counting as music" \
  "$OV" '          if (slot === null) continue;' \
  '          if (slot === null) return false;' \
  "$OVT" "does not count a rest"

probe "the search stops after the first section" \
  "$OV" '  for (const section of song.sections) {' \
  '  for (const section of song.sections.slice(0, 1)) {' \
  "$OVT" "finds music in a later section, not only the first"

probe "the workspace stops asking which view to open on" \
  "$NAV" '  const [view, setView] = useState<WorkspaceView>(() => openingView(song));' \
  '  const [view, setView] = useState<WorkspaceView>("arrange");' \
  "$OVT" "does not open on a hard-coded surface at mount"

echo
echo "== Section length (§15)"

probe "growing does not append" \
  "$SL" '              ...Array.from({ length: delta }, (): Bar => ({' \
  '              ...Array.from({ length: 0 }, (): Bar => ({' \
  "$SLT" "appends bars up to the number asked for"

probe "growing replaces the bars that were there" \
  "$SL" '          ? [
              ...section.bars,' \
  '          ? [
              ...section.bars.slice(0, 0),' \
  "$SLT" "keeps the music that was already there"

probe "new bars take the song's default metre instead of the section's" \
  "$SL" '                timeSignature: model.timeSignature,' \
  '                timeSignature: [4, 4] as const,' \
  "$SLT" "gives the new bars the shape of the last one, not the song's default"

probe "new bars take the song's default grid" \
  "$SL" '                resolution: model.resolution,' \
  '                resolution: 32 as const,' \
  "$SLT" "gives the new bars the shape of the last one, not the song's default"

probe "the section's own grouping is dropped from new bars" \
  "$SL" '                ...(model.grouping ? { grouping: [...model.grouping] } : {}),' \
  '                ...{},' \
  "$SLT" "gives the new bars the shape of the last one, not the song's default"

probe "new bars copy the last bar's music" \
  "$SL" '                slots: {},
              })),' \
  '                slots: { ...model.slots },
              })),' \
  "$SLT" "writes silence into the new bars rather than repeating the last one"

probe "shrinking drops from the front" \
  "$SL" '          : section.bars.slice(0, command.barCount);' \
  '          : section.bars.slice(section.bars.length - command.barCount);' \
  "$SLT" "takes the music in the dropped bars with it"

probe "shrinking keeps the bars it says it dropped" \
  "$SL" '          : section.bars.slice(0, command.barCount);' \
  '          : section.bars;' \
  "$SLT" "drops bars from the end"

# Four probes stood here and were taken out rather than reported as red:
# "zero bars is accepted", "the per-section cap stops being checked", "the cap
# is off by one" and "a fractional bar count is accepted". Each one mutated
# the command's own range check, and each one stayed green — not because the
# rule is untested, but because `guardCandidate` refuses the same shapes with
# the same error code one layer down. A probe that two guards both catch
# cannot say which of them is holding, so it measures nothing. The range check
# stays in the command (it names the error at the layer that knows the
# reader's intent); what does not stay is a probe pretending to prove it.

probe "the song's total is no longer checked when a section grows" \
  "$SL" '      if (totalBars(song) + delta > songLimits.totalBars) {
        return { ok: false, error: { code: "song_bar_limit_reached" } };
      }' \
  '      if (false) {
        return { ok: false, error: { code: "song_bar_limit_reached" } };
      }' \
  "$SLT" "refuses when the song as a whole would go over its limit"

probe "an unknown section is resized anyway" \
  "$SL" '      const index = sectionIndex(song, command.sectionId);
      if (index < 0) return { ok: false, error: { code: "section_not_found" } };
      const section = song.sections[index]!;' \
  '      const index = Math.max(0, sectionIndex(song, command.sectionId));
      const section = song.sections[index]!;' \
  "$SLT" "says nothing about a section that is not there"

probe "asking for the same length loses the section" \
  "$SL" '      if (delta === 0) return guardCandidate(song);' \
  '      if (delta === 0) return guardCandidate({ ...song, sections: [] });' \
  "$SLT" "asking for the length it already has changes nothing"

# "the resize command has no history sentence at all" stood here. Dropping the
# command from `LifecycleCommandKind` is a *type* error, and `tsc` is the gate
# that catches it — vitest transpiles without checking, so the probe reported
# a guard that was never asked to hold. The rule is enforced; not by a test.


echo
echo "== Track naming (§11)"

probe "the role word becomes the instrument's own name" \
  "$LAB" '  electric_guitar: "Gitar",' \
  '  electric_guitar: "Elektro gitar",' \
  "$TNT" "is not the instrument's own name, which is the defect"

probe "the bass loses its short word" \
  "$LAB" '  electric_bass: "Bas",' \
  '  electric_bass: "Elektro bas",' \
  "$TNT" "is the short one the starting templates already use"

probe "an unknown instrument is handed its id" \
  "$LAB" '  return TRACK_ROLE_NAMES[instrumentId] ?? instrumentName(instrumentId) ?? instrumentId;' \
  '  return TRACK_ROLE_NAMES[instrumentId] ?? instrumentName(instrumentId) ?? "Enstrüman";' \
  "$TNT" "falls back to something a reader recognises, never an id"

probe "the role words stop matching the templates" \
  "$LAB" 'export function trackRoleName(instrumentId: string): string {
  return TRACK_ROLE_NAMES[instrumentId]' \
  'export function trackRoleName(instrumentId: string): string {
  return INSTRUMENT_NAMES[instrumentId]' \
  "$TNT" "names every track the band template starts with"

probe "numbering counts the names instead of reading them" \
  "$IDS" '    highest = Math.max(highest, match[1] ? Number(match[1]) : 1);' \
  '    highest += 1;' \
  "$TNT" "takes the one after the highest, not after the count"

probe "an unnumbered name stops counting as the first" \
  "$IDS" '    highest = Math.max(highest, match[1] ? Number(match[1]) : 1);' \
  '    highest = Math.max(highest, match[1] ? Number(match[1]) : 0);' \
  "$TNT" "counts an unnumbered name as the first"

probe "the pattern stops anchoring at the front" \
  "$IDS" 'const pattern = new RegExp(`^${literal}' \
  'const pattern = new RegExp(`${literal}' \
  "$TNT" "ignores a name that only ends like the role"

probe "the pattern stops anchoring at the end" \
  "$IDS" '(?: (\\d+))?$`);' \
  '(?: (\\d+))?`);' \
  "$TNT" "ignores a name that only starts with the role"

probe "the role is spliced into the pattern unescaped" \
  "$IDS" '  const literal = role.replace(' \
  '  const literal = String(role) + "".replace(' \
  "$TNT" "treats a role with regex characters as text"

probe "numbering ignores the role and matches everything" \
  "$IDS" '    const match = pattern.exec(name.trim());
    if (!match) continue;' \
  '    const match = pattern.exec(name.trim());
    if (!match) { highest = Math.max(highest, 1); continue; }' \
  "$TNT" "ignores names in another series"

probe "numberedName becomes dedupeName again" \
  "$IDS" '  return `${role} ${highest + 1}`;' \
  '  return dedupeName(existing, role);' \
  "$TNT" "is not what dedupeName would have said"

probe "a track's role word stops being one word per instrument" \
  "$LAB" '  steel_acoustic: "Akustik Gitar",' \
  '  steel_acoustic: "Çelik telli akustik",' \
  "$TNT" "is the short one the starting templates already use"

echo
echo "== Limits (§15)"

probe "the song's total goes back to 32" \
  "$LIM" '  totalBars: 64,' \
  '  totalBars: 32,' \
  src/lib/validators/songLimits.test.ts "is the limit 2V-E.1 raised it to"

probe "the per-section cap moves without the measurement behind it" \
  "$LIM" '  barsPerSection: 8,' \
  '  barsPerSection: 64,' \
  src/lib/validators/songLimits.test.ts "is the limit 2V-E.1 raised it to"

probe "the Copilot patch size follows the song limit" \
  "$LIM" '  barsPerPatch: 8,' \
  '  barsPerPatch: 64,' \
  src/lib/validators/songLimits.test.ts "is the limit 2V-E.1 raised it to"

probe "the materialiser stops checking the song's length" \
  src/lib/copilot/materialize.ts '  if (totalBars > songLimits.totalBars) {' \
  '  if (false) {' \
  src/lib/copilot/blueprint.test.ts "a piece longer than the pilot allows"

echo
echo "== The first project (§4, §6, §7)"

probe "the first project takes a fixed id instead of an allocated one" \
  "$FP" '  const id = projectId(highestProjectNumber(scanProjectIds(env.storage)) + 1);' \
  '  const id = projectId(1);' \
  "$FPT" "allocates its id above whatever is already on disk"

probe "a refused write is reported as a success" \
  "$FP" '  const written = persist(withCatalog, id, settled.song);
  if (!written.ok) return written;' \
  '  const written = persist(withCatalog, id, settled.song);
  if (!written.ok) return { ...written, ok: true } as ProjectCommandResult;' \
  "$FPT" "leaves nothing behind when the device refuses the write"

probe "an unacceptable song is written anyway" \
  "$FP" '  const settled = settle(song);
  if (!settled.ok) return projectFail("project_validation_failed");

  const id = projectId(' \
  '  const settled = settle(song);

  const id = projectId(' \
  "$FPT" "refuses a song the contract will not accept, before writing anything"

probe "migration invents a library on an empty device" \
  "$MIG" '  if (legacy.outcome === "empty") {' \
  '  if (false) {' \
  src/lib/projects/project-migration.test.ts "makes nothing out of nothing, and writes nothing either"

probe "the session refuses to write before there is a project" \
  "$SES" '      session.canPersist = port !== null;' \
  '      session.canPersist = false;' \
  "$FPT" "turns the store from read-only into writable when the first opens"

probe "opening a project leaves the store read-only" \
  "$SES" '      store.replaceBaseline(song, { canPersist: port !== null });' \
  '      store.replaceBaseline(song);' \
  "$FPT" "turns the store from read-only into writable when the first opens"

echo
echo "== What a card says (§4)"

probe "the card stops carrying the key" \
  "$SUM" '    key: song.key,' \
  '    key: null,' \
  src/lib/home/home-model.test.ts "names the music by what it sounds like"

probe "an unreadable project invents a key and a tempo" \
  "$SUM" '    key: null,
    bpm: null,
    meter: null,' \
  '    key: "E minor",
    bpm: 120,
    meter: "4/4",' \
  src/lib/home/home-model.test.ts "says a project cannot be opened rather than showing it as empty"

probe "the meter is a constant rather than the first bar's" \
  "$SUM" '    meter: first ? `${first.timeSignature[0]}/${first.timeSignature[1]}` : null,' \
  '    meter: "7/8",' \
  src/lib/home/home-model.test.ts "names the music by what it sounds like"

echo
echo "== Home and the starting assumptions (§4, §5)"

probe "the empty-home blurb stops saying what the reader will do" \
  "$HM" 'İlk riffini yaz, enstrümanları ekle ve parçanı dinle.' \
  'Baslamak icin dokunun.' \
  src/lib/home/home-model.test.ts "says what the reader will get, not what the app is"

probe "the assumptions stop being read off the template" \
  "$FS" '    { label: "Ton", value: TEMPLATE_DEFAULTS.key },' \
  '    { label: "Ton", value: "A minor" },' \
  src/lib/home/home-model.test.ts "shows the assumptions it is making, read off that template"

probe "the first section's bar count is invented rather than read" \
  "$FS" '      value: `${TEMPLATE_DEFAULTS.sectionName} · ${TEMPLATE_DEFAULTS.barCount} ölçü`,' \
  '      value: `${TEMPLATE_DEFAULTS.sectionName} · 8 ölçü`,' \
  src/lib/home/home-model.test.ts "shows the assumptions it is making, read off that template"

probe "Home repeats the open project in the rest of the list" \
  "$HM" '  const others = byRecency.filter((card) => card.id !== recent?.id);' \
  '  const others = byRecency;' \
  src/lib/home/home-model.test.ts "never repeats the recent project in the rest of the list"

echo
echo "== The save status (§7)"

probe "the status says saved before the write lands" \
  "$SS" 'Kaydediliyor…' \
  'Kaydedildi' \
  src/lib/home/save-status.test.ts "never says saved while a write is still in flight"

probe "a failed save is not offered a retry" \
  "$SS" 'Tekrar dene' \
  'Bekleyin' \
  src/lib/home/save-status.test.ts "says a failure is a failure, and offers the one thing that helps"

echo
echo "== The listening record stays closed (§1)"

probe "L31's refusal is upgraded because a later card passed" \
  "$FA" '    id: "L31",
    title: "Aynı riff, iki gruplama",
    verdict: "fail",' \
  '    id: "L31",
    title: "Aynı riff, iki gruplama",
    verdict: "pass",' \
  src/lib/listening/founder-authority.test.ts "keeps L31 refuted although the next card passed"

probe "the archive loses one of the round's three passes" \
  "$FA" '  { id: "L35", title: "İfade eklenince ses dengesi", verdict: "pass" },' \
  '' \
  src/lib/listening/founder-authority.test.ts "holds every card the founder has judged, in order"

probe "the round re-opens a card nobody asked for" \
  "$SCOPE" 'export const ACTIVE_CLIP_IDS: readonly string[] = [];' \
  'export const ACTIVE_CLIP_IDS: readonly string[] = ["L31"];' \
  src/lib/listening/founder-authority.test.ts "never asks a card whose answer is already recorded"

echo
echo "== The rest of the loop (§4, §7, §12, §19)"

probe "the summary counts the bars of only the first section" \
  "$SUM" '  for (const section of song.sections) barCount += section.bars.length;' \
  '  barCount = song.sections[0]?.bars.length ?? 0;' \
  src/lib/projects/project-summary.test.ts "counts the sections, bars and tracks that are really there"

probe "the summary counts tracks by section rather than by song" \
  "$SUM" '    trackCount: song.tracks.length,' \
  '    trackCount: song.sections.length,' \
  src/lib/projects/project-summary.test.ts "counts the sections, bars and tracks that are really there"

probe "the card takes its name from somewhere other than the song" \
  "$SUM" '    title: song.title,' \
  '    title: id,' \
  src/lib/projects/project-summary.test.ts "takes its name from the song's title and nowhere else"

probe "an unreadable project is reported with zeroes" \
  "$SUM" '    sectionCount: null,
    barCount: null,
    trackCount: null,' \
  '    sectionCount: 0,
    barCount: 0,
    trackCount: 0,' \
  src/lib/projects/project-summary.test.ts "shows no counts at all rather than zeroes"

probe "a pending write on a read-only device claims to be saving" \
  "$SS" '    return { state: "read_only", text: READ_ONLY, retryable: false };' \
  '    return { state: "saving", text: READ_ONLY, retryable: false };' \
  src/lib/home/save-status.test.ts "a pending write on a read-only device is still read-only"

probe "the save status leaks a code into one of its four sentences" \
  "$SS" 'Kaydedilemedi' \
  'Kaydedilemedi (E_QUOTA)' \
  src/lib/home/save-status.test.ts "shows no code, key or diagnostic in any of the four"

# Two probes stood here and came out: one aimed at a string that is not in the
# source, and one at a migration *step name* no test asserts. Neither was
# measuring anything, and a probe that measures nothing is worse than no probe
# — it fills a count. The steps list is a diagnostic; what the tests hold that
# migration to is what it writes, and that is probed above.

probe "the tie in an untouched song stops being looked for at all" \
  "$OV" '        for (const slot of slots) {' \
  '        for (const slot of slots.slice(0, 0)) {' \
  "$OVT" "is not what dedupeName would have said|counts a tie as sound, because it carries one"

echo
echo "-------------------------------------------------------------"
echo "RED (the guard fired):      $pass"
echo "STAYED-GREEN (no guard):    $green"
echo "NO-TEST-MATCHED (bad probe):$nomatch"
echo "SETUP-FAIL (broken probe):  $setup"
echo "RESTORE-FAIL:               $restore_fail"
[ "$green" -eq 0 ] && [ "$restore_fail" -eq 0 ] && [ "$setup" -eq 0 ] && [ "$nomatch" -eq 0 ]
