#!/usr/bin/env bash
# Build and serve the production app for the browser harnesses.
#
# A server left running from an earlier round keeps serving the .next it was
# started with, and a rebuild underneath it leaves the browser fetching chunk
# files that no longer exist: 500s, a fallback to the demo song, and a whole
# measurement run that quietly tested the wrong build. So this kills first,
# builds second, starts third and refuses to hand back until the running
# server's build id matches the one on disk.
set -euo pipefail
PORT="${PORT:-3100}"

pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "next start" 2>/dev/null || true
for _ in $(seq 1 20); do
  curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}/" || break
  sleep 1
done

npm run build > /dev/null
BUILD_ID="$(cat .next/BUILD_ID)"

nohup npx next start -p "${PORT}" > /tmp/aranje-next.log 2>&1 &
for _ in $(seq 1 60); do
  sleep 1
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/" | grep -q "${BUILD_ID}"; then
    echo "serving ${BUILD_ID} on ${PORT}"
    exit 0
  fi
done
echo "server did not come up on ${BUILD_ID}" >&2
tail -20 /tmp/aranje-next.log >&2
exit 1
