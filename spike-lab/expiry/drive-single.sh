#!/bin/bash
# One instance: what a write inside a request, a CLI write with and without the
# expire route, and a timer write outside any request each leave readers seeing.
set -u
L=$(cd "$(dirname "$0")" && pwd)
export LAB_DATA=$L/run/data.json LAB_SECRET=lab-secret NEXT_TELEMETRY_DISABLED=1 PORT=3200
echo '{"value":"v0","writtenAt":0}' >| "$LAB_DATA"
read_both() { # what the cached data route and the prerendered page serve now
  api=$(curl -s localhost:3200/api/read | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).value))')
  page=$(curl -s localhost:3200/ | grep -o '<p id="value">[^<]*' | sed 's/.*>//')
  echo "  api=$api page=$page"
}
start() { (cd "$L" && exec ./node_modules/next/dist/bin/next start -p 3200) > "$L/run/server-$1.log" 2>&1 & server=$!
  for _ in $(seq 1 60); do curl -s -o /dev/null localhost:3200/api/read && return; sleep 0.5; done; echo "no server"; exit 1; }
stop() { kill "$server" 2>/dev/null; wait "$server" 2>/dev/null
  # This slot's port only: a child next start left listening on it.
  for p in $(lsof -ti tcp:3200 -sTCP:LISTEN); do kill "$p"; done; sleep 1; }

start plain
echo "start (v0 cached):"; read_both; read_both
curl -s -X POST localhost:3200/api/write -H 'content-type: application/json' -d '{"value":"v1"}' >/dev/null
echo "after an in-request write of v1:"; read_both
node "$L/cli.mjs" v2
echo "after a CLI write of v2, no expiry:"; read_both; sleep 3; echo "  ...3 s later:"; read_both
node "$L/cli.mjs" v3 --expire
echo "after a CLI write of v3 plus the expire route:"; read_both
stop

export LAB_TIMER=1 LAB_TIMER_DELAY_MS=6000
echo '{"value":"v0","writtenAt":0}' >| "$LAB_DATA"
start timer
echo "timer run, before the timer (v0):"; read_both
sleep 8
echo "after the timer wrote timer-write outside any request:"; read_both
grep 'LAB timer' "$L/run/server-timer.log"
stop
