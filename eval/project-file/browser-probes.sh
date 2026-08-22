#!/usr/bin/env bash
# 2L-A vacuity probes that need the real browser.
#
# Seven mutations against the project-file flow's browser-only guarantees:
# what a backup writes, what a preview touches, what an apply clears, and
# what a session that cannot save is allowed to do. Each breaks a guarantee,
# rebuilds, and asserts the acceptance run goes red. The unit-suite probes
# live in probes.sh.
set -u

pass=0; fail=0

restart() {
  pkill -f '[n]ext-server' >/dev/null 2>&1; sleep 1
  (npx next start -p 3100 >/tmp/aranje-probe-server.log 2>&1 &); sleep 6
}

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

  if npm run build >/dev/null 2>&1; then
    restart
    if ONE_VIEWPORT=1 node eval/project-file/verify.mjs >/tmp/aranje-probe-run.log 2>&1; then
      echo "GREEN $name  <-- VACUOUS"; fail=$((fail+1))
    else
      echo "RED   $name  ($(grep -c '^FAIL' /tmp/aranje-probe-run.log) scenarios)"; pass=$((pass+1))
    fi
  else
    echo "BROKEN $name (build failed)"; fail=$((fail+1))
  fi
  mv "$file.probebak" "$file"
}

# 4 — a backup is a read; it writes nothing anywhere
probe "4 the backup writes the song key" \
  src/lib/project/use-project-file.ts \
  '    setExportError(null);

    const blob = new Blob([result.text], { type: PROJECT_FILE_MIME });' \
  '    setExportError(null);
    window.localStorage.setItem("aranje.song", result.text);

    const blob = new Blob([result.text], { type: PROJECT_FILE_MIME });'

# 12 — the preview touches no storage
probe "12 the preview writes what it read" \
  src/lib/project/use-project-file.ts \
  '        setState({
          status: "preview",' \
  '        window.localStorage.setItem("aranje.song", text);
        setState({
          status: "preview",'

# 14 — the clipboards go with the song they were cut from
probe "14 the clipboard survives the apply" \
  src/components/workspace/Workspace.tsx \
  '    transform.clearClipboard();
    barTransform.clearClipboard();' \
  ''

# 15 — the loop closes, even when the imported song has the same section id
probe "15 the loop stays armed across the apply" \
  src/components/workspace/Workspace.tsx \
  '    controller.setLoopSection(null);
    controller.rewind();' \
  '    controller.rewind();'

# 16 — a session that cannot save cannot open a project
probe "16 apply opens without canPersist" \
  src/components/workspace/ProjectFileSheet.tsx \
  '                  disabled={!canPersist}' \
  '                  disabled={false}'

# 17 — every minted Object URL is revoked
probe "17 the download URL is never revoked" \
  src/lib/project/use-project-file.ts \
  '    setTimeout(() => {
      URL.revokeObjectURL(url);
      pendingUrls.current.delete(url);
    }, 0);' \
  ''

# 19 — the project flow makes no network request
probe "19 the import phones home" \
  src/lib/project/use-project-file.ts \
  '    file.text().then(' \
  '    void fetch("https://example.com/aranje-probe").catch(() => {});
    file.text().then('

echo
echo "RED: $pass  VACUOUS: $fail"
# Leave the tree rebuilt clean for whatever runs next.
npm run build >/dev/null 2>&1
restart
[ "$fail" -eq 0 ]
