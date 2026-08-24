#!/usr/bin/env bash
# Vacuity probes for the project library (2O-A §27).
#
# Each one puts back a way the library could quietly lose somebody's music —
# a migration that trusts a write it never read back, an edit that lands in
# the wrong project, a delete that strands a payload — and asserts that a
# named test really goes red.
#
# The mutations are the *dangerous* behaviour, not a syntax error: a probe that
# only breaks compilation proves nothing about the test.
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

MIG="npx vitest run src/lib/projects/project-migration.test.ts"
CMD="npx vitest run src/lib/projects/project-commands.test.ts"
CAT="npx vitest run src/lib/projects/project-catalog.test.ts"
REC="npx vitest run src/lib/projects/project-record.test.ts"
STORE="npx vitest run src/lib/projects/project-store.test.ts"
BOUND="npx vitest run src/lib/projects/project-library-boundary.test.ts"
WB="npx vitest run src/lib/workspace/workspace-boundary.test.ts"
PF="npx vitest run src/lib/project/project-file.test.ts src/lib/export/export-orchestration.test.ts"
# The browser probes rebuild and restart, because a mutation that never
# reaches the bundle would be measured against the previous build's code.
BROWSER="npm run build && (fuser -k 3100/tcp 2>/dev/null; sleep 1; npx next start -p 3100 & sleep 5) && ONE_VIEWPORT=1 node eval/projects/verify.mjs"

# ------------------------------------------------------------- migration

# 1 — the old key goes before the new one has been read back
probe "1 migration removes the old key without verifying the new one" \
  src/lib/projects/project-migration.ts \
  '  if (!verifyRecord(storage, FIRST_PROJECT_ID, legacy.song)) {' \
  '  if (false && !verifyRecord(storage, FIRST_PROJECT_ID, legacy.song)) {' \
  "$MIG"

# 2 — a broken catalog takes the payloads down with it
probe "2 a broken catalog deletes the payloads it named" \
  src/lib/projects/project-migration.ts \
  '  const verified = scanProjectIds(storage).filter(
    (id) => readRecord(storage, id).kind === "record",
  );' \
  '  const verified = scanProjectIds(storage).filter((id) => {
    if (readRecord(storage, id).kind === "record") return true;
    removeRecord(storage, id);
    return false;
  });' \
  "$MIG"

# 3 — a newer version's catalog is quarantined and written over
probe "3 a future-version catalog is overwritten" \
  src/lib/projects/project-migration.ts \
  '  if (decision.kind === "future_version") {' \
  '  if (false && decision.kind === "future_version") {' \
  "$MIG"

# 4 — an orphan payload is left stranded instead of adopted
probe "4 an orphan payload is never adopted" \
  src/lib/projects/project-migration.ts \
  '  if (adopted.length === 0) return catalog;' \
  '  return catalog;
  if (adopted.length === 0) return catalog;' \
  "$MIG"

# 5 — migration runs even though real projects were found on the device
#     (the catalog fast path is only an optimisation; *this* is the guard)
probe "5 migration runs on top of a library that already exists" \
  src/lib/projects/project-migration.ts \
  '  if (rebuilt !== null) {' \
  '  if (false && rebuilt !== null) {' \
  "$MIG"

# 6 — unreadable bytes in a project key are written over rather than left.
# Aimed at the store suite, not the migration one: migration has its own
# "first slot is occupied" guard, so it would survive this mutation and prove
# nothing. The hazard this refusal exists for is the open project whose record
# went bad mid-session (describe 145).
probe "6 a corrupt project record is written over" \
  src/lib/projects/project-storage.ts \
  '  if (onDisk.kind === "corrupt" && options.allowOverwriteCorrupt !== true) {' \
  '  if (false) {' \
  "$STORE"

# 7 — an unreadable delete note is acted on anyway
probe "7 an unreadable pending note deletes something" \
  src/lib/projects/project-storage.ts \
  '  } catch {
    /* An unreadable note is no note: nothing is deleted on a guess. */
  }
  return null;' \
  '  } catch {
    return { kind: "delete", projectId: "project-2" };
  }
  return null;' \
  "$MIG"

# ------------------------------------------------------------- the catalog

# 8 — a duplicate project id is accepted
probe "8 a duplicate project id passes the catalog" \
  src/lib/projects/project-catalog.ts \
  '  if (new Set(catalog.projectIds).size !== catalog.projectIds.length) {
    issues.push("duplicate_project_id");
  }' \
  '' \
  "$CAT"

# 9 — the active project need not be in the list
probe "9 activeProjectId may name a project that is not there" \
  src/lib/projects/project-catalog.ts \
  '  if (!catalog.projectIds.includes(catalog.activeProjectId)) {
    issues.push("active_project_missing");
  }' \
  '' \
  "$CAT"

# 10 — the counter hands out a name that already exists
probe "10 a deleted id is handed out again" \
  src/lib/projects/project-catalog.ts \
  '  const number = Math.max(
    catalog.nextProjectNumber,
    highestProjectNumber(catalog.projectIds) + 1,
  );' \
  '  const number = catalog.projectIds.length + 1;' \
  "$CAT"

# 11 — the id becomes a timestamp
probe "11 the project id is a timestamp" \
  src/lib/projects/project-catalog.ts \
  '  return {
    id: projectId(number),
    catalog: { ...catalog, nextProjectNumber: number + 1 },
  };' \
  '  return {
    id: projectId(number + (Date.now() % 1000)),
    catalog: { ...catalog, nextProjectNumber: number + 1 },
  };' \
  "$BOUND"

# 12 — an unknown key is silently dropped instead of refused
probe "12 an unknown catalog key is dropped silently" \
  src/lib/projects/project-catalog.ts \
  'const catalogShellSchema = z.strictObject({' \
  'const catalogShellSchema = z.object({' \
  "$CAT"

# ------------------------------------------------------------- the record

# 13 — a newer version's project record is called corrupt
probe "13 a future-version project record is treated as corrupt" \
  src/lib/projects/project-record.ts \
  '  if (tag.data.version !== PROJECT_RECORD_VERSION) {
    return { kind: "future_version", version: tag.data.version };
  }' \
  '' \
  "$REC"

# 14 — the rung below the current song is dropped
probe "14 a record keeps no previous song" \
  src/lib/projects/project-record.ts \
  '  if (inner.kind === "recovered_previous") {' \
  '  if (false && inner.kind === "recovered_previous") {' \
  "$REC"

# 15 — a record accepts any id, so a key can be named by user text
probe "15 a record accepts an id that is not a project id" \
  src/lib/projects/project-record.ts \
  '  projectId: z.string().regex(PROJECT_ID_PATTERN),' \
  '  projectId: z.string(),' \
  "$REC"

# ------------------------------------------------------------ the commands

# 16 — the last project becomes deletable
probe "16 the last project can be deleted" \
  src/lib/projects/project-commands.ts \
  '  if (env.catalog.projectIds.length <= 1) return projectFail("cannot_delete_last_project");' \
  '' \
  "$CMD"

# 17 — deleting the open project picks the wrong survivor
probe "17 the survivor after deleting the open project is wrong" \
  src/lib/projects/project-commands.ts \
  '      ? remaining[survivorIndex(index, remaining.length)]' \
  '      ? remaining[0]' \
  "$CMD"

# 18 — a duplicate writes back over the project it is copying
probe "18 duplicating a project writes over the source" \
  src/lib/projects/project-commands.ts \
  '  return addProject(env, {
    ...record.song,
    title: duplicateTitle(record.song.title, existingTitles(env)),
  });' \
  '  const renamed = {
    ...record.song,
    title: duplicateTitle(record.song.title, existingTitles(env)),
  };
  writeRecord(env.storage, id, renamed, env.now);
  return addProject(env, renamed);' \
  "$CMD"

# 19 — a new project takes the open one's key
probe "19 a new project is written over the open one" \
  src/lib/projects/project-commands.ts \
  '  const allocated = allocateProjectId(env.catalog);' \
  '  const allocated = { id: env.catalog.activeProjectId, catalog: env.catalog };' \
  "$CMD"

# 20 — the write is never read back
probe "20 a payload write is trusted without reading it back" \
  src/lib/projects/project-commands.ts \
  '  const back = readRecord(env.storage, id);
  if (back.kind !== "record" || !sameSong(back.song, song)) {
    return projectFail("project_storage_write_failed");
  }' \
  '' \
  "$CMD"

# 21 — the catalog moves before the target has been verified
probe "21 the catalog opens a project that could not be read" \
  src/lib/projects/project-commands.ts \
  '  if (record.kind === "corrupt") return projectFail("project_corrupt");' \
  '' \
  "$CMD"

# 22 — a delete leaves no note, so an interruption cannot be finished
probe "22 a delete leaves no pending note" \
  src/lib/projects/project-commands.ts \
  '  const noted = writePending(env.storage, { kind: "delete", projectId: id });
  if (!noted.ok) return projectFail("project_storage_write_failed");' \
  '' \
  "$CMD"

# 23 — a payload that could not be removed is reported as a clean delete
probe "23 a failed payload removal is reported as success" \
  src/lib/projects/project-commands.ts \
  '  if (!removed.ok) {' \
  '  if (false && !removed.ok) {' \
  "$CMD"

# 24 — the validators stop gating what becomes a project
probe "24 an invalid song becomes a project" \
  src/lib/projects/project-commands.ts \
  '  const settled = settle(song);
  if (!settled.ok) return projectFail("project_validation_failed");' \
  '  const settled = { ok: true as const, song, warnings: [] };' \
  "$CMD"

# ------------------------------------------------------ store and boundaries

# 25 — every project shares one store target
probe "25 edits land in the old single-song key whatever is open" \
  src/lib/song/song-store.ts \
  '    const saved = persistence
      ? persistence.save(song)
      : storage === undefined' \
  '    const saved = false
      ? persistence.save(song)
      : storage === undefined' \
  "$STORE"

# 26 — a stale tab writes anyway
probe "26 a stale tab commits over another tab's work" \
  src/lib/projects/active-project.ts \
  '      if (onDisk !== null && onDisk !== active.revision) {' \
  '      if (false && onDisk !== null && onDisk !== active.revision) {' \
  "$STORE"

# 27 — opening a project keeps the history of the last one
probe "27 undo can cross a project boundary" \
  src/lib/projects/project-session.ts \
  '      store.replaceBaseline(song);' \
  '      void song;' \
  "$STORE"

# 28 — the project file starts carrying library metadata
probe "28 the project file leaks the project id" \
  src/lib/project/project-file.ts \
  '  return `${JSON.stringify(canonical(file))}\n`;' \
  '  return `${JSON.stringify(canonical({ ...file, projectId: "project-1" }))}\n`;' \
  "$BOUND"

# 29 — a component reaches storage directly
probe "29 a component imports storage directly" \
  src/components/workspace/ProjectLibrarySheet.tsx \
  'import { Sheet, SheetButton } from "@/components/workspace/Sheet";' \
  'import { readCatalog } from "@/lib/projects/project-storage";
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
void readCatalog;' \
  "$BOUND"

# 30 — the summary is taken from the catalog rather than from the song
probe "30 the list shows a cached shape instead of the song's" \
  src/lib/projects/project-summary.ts \
  '  let barCount = 0;
  for (const section of song.sections) barCount += section.bars.length;' \
  '  const barCount = 0;' \
  "npx vitest run src/lib/projects/project-summary.test.ts"

# 31 — the workspace budget is lifted
probe "31 the workspace line budget is exceeded" \
  src/components/workspace/Workspace.tsx \
  '"use client";' \
  '"use client";
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
  "$WB"

# ------------------------------------------------------------ browser probes

# 32 — a device that cannot write still offers to make a project
probe "32 storage unavailable still opens create" \
  src/lib/workspace/use-project-library.ts \
  '  const canModify = canPersist && session?.canPersist === true && catalog !== null;' \
  '  const canModify = true;' \
  "$BROWSER"

# 33 — the session ground is skipped on a project switch
probe "33 a project switch does not put the session down" \
  src/lib/workspace/use-project-library.ts \
  '      if (switching) onBeforeSwitch();' \
  '      void switching;' \
  "$BROWSER"

# 34 — a raw diagnostic reaches the reader
probe "34 a raw storage diagnostic reaches the sheet" \
  src/components/workspace/ProjectLibrarySheet.tsx \
  '          Bu cihazda kayıtlı proje listesi açılamadı. Ekrandaki şarkıyı
          dinleyebilir ve yedekleyebilirsin.' \
  '          localStorage aranje.projects: JSON.parse failed (Zod)' \
  "$BROWSER"

# Leave the bundle — and the artefacts every browser probe overwrote — as the
# committed sources describe them. Without this last clean pass the JSON on
# disk is the *last mutation's* run, which reads as a real regression, and the
# running server still serves mutated code.
npm run build >/dev/null 2>&1
fuser -k 3100/tcp >/dev/null 2>&1
sleep 1
(npx next start -p 3100 >/dev/null 2>&1 &)
sleep 5
node eval/projects/verify.mjs >/dev/null 2>&1
clean=$?

echo
echo "RED: $pass  VACUOUS: $fail"
if [ "$clean" -ne 0 ]; then
  echo "WARNING: the clean re-measurement did not pass — RESULTS.json is not trustworthy"
fi
[ "$fail" -eq 0 ] && [ "$clean" -eq 0 ]
