#!/usr/bin/env bash
# Start the built app on 3114 and wait for it.
#
# The build sha comes from `next.config.ts`, which asks git at *build* time —
# so this only serves whatever `npm run build` last produced. Rebuild after a
# commit or the founder routes will refuse the link, correctly, for naming a
# commit the bundle was not built from.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3114}"
PIDFILE="/tmp/aranje-eval-$PORT.pid"

# Whatever is holding the port, not merely whatever this script last started:
# `next start` forks a child server, so the recorded pid is the wrapper and
# killing it leaves the listener behind — which then serves a stale build while
# every new start fails with EADDRINUSE in a log nobody reads. Asked by port,
# because a name match would also find the shell that is running this.
fuser -k -n tcp "$PORT" 2>/dev/null || true
rm -f "$PIDFILE"
sleep 2

nohup npx next start -p "$PORT" > "/tmp/aranje-eval-$PORT.log" 2>&1 &
echo $! > "$PIDFILE"

for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "up on $PORT · sha $(git rev-parse --short HEAD) · pid $(cat "$PIDFILE")"
    exit 0
  fi
  sleep 1
done
echo "server did not come up"; tail -20 "/tmp/aranje-eval-$PORT.log"; exit 1
