#!/usr/bin/env bash
# Vacuity probes for 2L-R — the unit-suite half.
#
# Each probe re-creates one way the decomposition could quietly rot — command
# code creeping back into the root, a second state owner, a per-cell listener,
# an eval import in the product — and asserts a named test actually goes red.
# The four that guard browser-only behaviour live in browser-probes.sh.
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

W="npx vitest run src/lib/workspace/workspace-boundary.test.ts"
H="npx vitest run src/lib/song/history-boundary.test.ts"
P="npx vitest run src/lib/project/project-boundary.test.ts"

# 1 — domain command implementation moves back into the root
probe "1 Workspace imports applyEdit again" \
  src/components/workspace/Workspace.tsx \
  'import { isEditableTrack } from "@/lib/song/edit";' \
  'import { applyEdit, isEditableTrack } from "@/lib/song/edit";' \
  "$W"

# 2 — the root reaches storage directly
probe "2 Workspace imports storage" \
  src/components/workspace/Workspace.tsx \
  'import { useSong } from "@/lib/song/use-song";' \
  'import { useSong } from "@/lib/song/use-song";
import { saveSong } from "@/lib/song/storage";
void saveSong;' \
  "$W"

# 3 — the root grows a project parser
probe "3 Workspace imports the project parser" \
  src/components/workspace/Workspace.tsx \
  'import { useProjectFile } from "@/lib/project/use-project-file";' \
  'import { useProjectFile } from "@/lib/project/use-project-file";
import { parseProjectText } from "@/lib/project/project-file";
void parseProjectText;' \
  "$W"

# 4 — a second controller starts holding the view state
probe "4 navigation state grows a second owner" \
  src/lib/workspace/use-selection-session.ts \
  '  const [pasteAt, setPasteAt] = useState<PasteFlow>({ kind: "idle" });' \
  '  const [pasteAt, setPasteAt] = useState<PasteFlow>({ kind: "idle" });
  const [probeView] = useState<WorkspaceView>("arrange");
  void probeView;' \
  "$W"

# 6 — the arrangement opens a second animation frame
probe "6 a second requestAnimationFrame appears" \
  src/components/workspace/ArrangementCanvas.tsx \
  '  const columnRef = useRef<HTMLDivElement | null>(null);' \
  '  const columnRef = useRef<HTMLDivElement | null>(null);
  requestAnimationFrame(() => {});' \
  "$W"

# 7 — a third per-cell listener
probe "7 a cell grows another listener" \
  src/components/workspace/arrangement/ArrangementCells.tsx \
  '      {...longPress}
      onClick={onOpen}' \
  '      {...longPress}
      onPointerDown={() => {}}
      onClick={onOpen}' \
  "$W"

# 9 — the project import bypasses the unified commit
probe "9 the import hook grows its own storage path" \
  src/lib/project/use-project-file.ts \
  'import { useCallback, useEffect, useRef, useState } from "react";' \
  'import { useCallback, useEffect, useRef, useState } from "react";
import { saveSong } from "@/lib/song/storage";
void saveSong;' \
  "$P"

# 11 — a suite grows its own press copy back
probe "11 a harness re-inlines the shared helper" \
  eval/storage/verify.mjs \
  'import { press } from "../shared/harness.mjs";' \
  'const press = async () => {};
void press;' \
  "$W"

# 12 — product code imports an eval helper
probe "12 product code imports eval scaffolding" \
  src/lib/workspace/use-workspace-overlays.ts \
  'import { useCallback, useState } from "react";' \
  'import { useCallback, useState } from "react";
import "../../../eval/shared/harness.mjs";' \
  "$W"

# 13 — the cursor check falls back to string matching. Alone, the grep would
# pass by luck; paired with a harmless Tailwind class it flags an innocent
# component, which is exactly the false positive the AST version removed.
cp src/components/workspace/ProjectFileSheet.tsx src/components/workspace/ProjectFileSheet.tsx.pairbak
python3 - <<'PY'
p="src/components/workspace/ProjectFileSheet.tsx"
s=open(p,encoding="utf-8").read()
s=s.replace('className="border-line text-text flex min-h-11 items-center','className="border-line text-text cursor-pointer flex min-h-11 items-center',1)
open(p,"w",encoding="utf-8").write(s)
PY
probe "13 the reverted grep flags an innocent Tailwind class" \
  src/lib/song/history-boundary.test.ts \
  '      expect(
        arithmeticIdentifiersOf(path).has("cursor"),
        `${source.name} does cursor arithmetic`,
      ).toBe(false);' \
  '      expect(source.text, source.name).not.toMatch(/cursor\s*[+-]/);' \
  "$H"
mv src/components/workspace/ProjectFileSheet.tsx.pairbak src/components/workspace/ProjectFileSheet.tsx

# 14 — the Workspace line budget is exceeded
probe "14 Workspace grows past its budget" \
  src/components/workspace/Workspace.tsx \
  'export function Workspace() {' \
  "$(python3 -c "print('// padding' + chr(10) + ('//' + chr(10)) * 500 + 'export function Workspace() {')")" \
  "$W"

# 15 — the ArrangementCanvas line budget is exceeded
probe "15 ArrangementCanvas grows past its budget" \
  src/components/workspace/ArrangementCanvas.tsx \
  'export function ArrangementCanvas({' \
  "$(python3 -c "print('// padding' + chr(10) + ('//' + chr(10)) * 200 + 'export function ArrangementCanvas({')")" \
  "$W"

echo
echo "RED: $pass  VACUOUS: $fail"
[ "$fail" -eq 0 ]
