#!/usr/bin/env bash
# Vacuity probes for 2L-A — the unit-suite half.
#
# Each probe breaks one guarantee of the project-file contract and asserts a
# named test actually goes red. Fifteen run here against the pure suite; the
# seven that guard browser-only behaviour (downloads, clipboards, loops,
# disabled controls, network) live in browser-probes.sh.
set -u

pass=0; fail=0
probe() {
  local name="$1" file="$2" find="$3" repl="$4" cmd="$5"
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

U="npx vitest run src/lib/project"

# 1 — the file carries the music and nothing else
probe "1 export smuggles a history into the file" \
  src/lib/project/project-file.ts \
  '      song: parsed.data,
    }),' \
  '      song: parsed.data,
      history: [],
    }),' \
  "$U"

# 2 — the storage envelope must never reach a portable file
probe "2 export wraps the song in a recovery envelope" \
  src/lib/project/project-file.ts \
  '      song: parsed.data,
    }),' \
  '      song: { current: parsed.data, previous: null },
    }),' \
  "$U"

# 3 — no timestamp, no runtime metadata
probe "3 export stamps the file with a timestamp" \
  src/lib/project/project-file.ts \
  '      song: parsed.data,
    }),' \
  '      song: parsed.data,
      exportedAt: Date.now(),
    }),' \
  "$U"

# 5 — a file name a filesystem would refuse must never be offered
probe "5 forbidden characters survive into the file name" \
  src/lib/project/project-file-name.ts \
  '    .replace(FORBIDDEN, "")' \
  '' \
  "$U"

# 6 — the byte bound is the guard that runs before any reading
probe "6 the import size guard is gone" \
  src/lib/project/project-file.ts \
  '  return sizeBytes > projectFileLimits.maxImportBytes;' \
  '  return false;' \
  "$U"

# 7 — a raw legacy Song is a storage matter, not a project file
probe "7 a raw legacy Song is quietly accepted" \
  src/lib/project/project-file.ts \
  '  if (songSchema.safeParse(parsed).success) {
    return { ok: false, code: "invalid_project" };
  }' \
  '  const legacy = songSchema.safeParse(parsed);
  if (legacy.success) return { ok: true, song: legacy.data, warnings: [] };' \
  "$U"

# 8 — an unknown outer key is a refusal, not a shrug
probe "8 the outer shell stops being strict" \
  src/lib/project/project-file.ts \
  'const projectShellSchema = z.strictObject({' \
  'const projectShellSchema = z.object({' \
  "$U"

# 9 — a future version is not ours to open, and not "invalid" either
probe "9 a future version is treated like anything else" \
  src/lib/project/project-file.ts \
  '  if (tag.data.version !== PROJECT_FILE_VERSION) {
    return { ok: false, code: "unsupported_project_version" };
  }' \
  '' \
  "$U"

# 10 — validator errors block the import
probe "10 a song with validator errors imports anyway" \
  src/lib/project/project-file.ts \
  '  const issues = runValidators(song.data);
  if (errorsOnly(issues).length > 0) return { ok: false, code: "song_invalid" };' \
  '  const issues = runValidators(song.data);' \
  "$U"

# 11 — the preview reads the song and changes nothing
probe "11 the preview mutates the song it describes" \
  src/lib/project/project-file.ts \
  '  const instrumentIds: string[] = [];' \
  '  song.tracks.pop();
  const instrumentIds: string[] = [];' \
  "$U"

# 13 — every apply goes through the one commit gate
probe "13 the hook grows its own storage path" \
  src/lib/project/use-project-file.ts \
  'import { useCallback, useEffect, useRef, useState } from "react";' \
  'import { useCallback, useEffect, useRef, useState } from "react";
import { saveSong } from "@/lib/song/storage";' \
  "$U"

# 18 — no diagnostic word ever reaches a musician
probe "18 a technical diagnostic enters the message table" \
  src/lib/project/project-file-errors.ts \
  '  file_read_failed: "Dosya okunamadı. Dosyayı yeniden seçmeyi dene.",' \
  '  file_read_failed: "JSON parse error",' \
  "$U"

# 20 — prototype-pollution keys are refused, everywhere in the file
probe "20 attack keys are no longer scanned for" \
  src/lib/project/project-file.ts \
  '  if (Array.isArray(value)) return value.some(carriesAttackKey);' \
  '  return false;
  if (Array.isArray(value)) return value.some(carriesAttackKey);' \
  "$U"

# 21 — project machinery stays out of Workspace
probe "21 Workspace imports the parser" \
  src/components/workspace/Workspace.tsx \
  'import { useProjectFile } from "@/lib/project/use-project-file";' \
  'import { useProjectFile } from "@/lib/project/use-project-file";
import { parseProjectText } from "@/lib/project/project-file";' \
  "$U"

# 22 — ArrangementCanvas gains no project wiring
probe "22 ArrangementCanvas imports the project flow" \
  src/components/workspace/ArrangementCanvas.tsx \
  '"use client";' \
  '"use client";
import { parseProjectText } from "@/lib/project/project-file";' \
  "$U"

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
