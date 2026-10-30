#!/bin/bash
# Mechanism a: every cached read has a LAB_REVALIDATE-second lifetime. A CLI
# write with no expiry is made, and both reads are polled once a second until
# they serve it, to measure when a reader first sees the write.
set -u
L=$(cd "$(dirname "$0")" && pwd)
export LAB_DATA=$L/run/data.json NEXT_TELEMETRY_DISABLED=1 LAB_REVALIDATE=${LAB_REVALIDATE:-10}
rm -rf "$L/.next"; echo '{"value":"v0","writtenAt":0}' >| "$LAB_DATA"
(cd "$L" && ./node_modules/next/dist/bin/next build > "$L/run/build-lifetime.log" 2>&1) || { echo "build failed"; tail -20 "$L/run/build-lifetime.log"; exit 1; }
(cd "$L" && exec ./node_modules/next/dist/bin/next start -p 3200) > "$L/run/server-lifetime.log" 2>&1 & server=$!
for _ in $(seq 1 60); do curl -s -o /dev/null localhost:3200/api/read && break; sleep 0.5; done
curl -s -o /dev/null localhost:3200/api/read; curl -s -o /dev/null localhost:3200/
t0=$(node -e 'console.log(Date.now())')
node "$L/cli.mjs" w1
for i in $(seq 1 $((LAB_REVALIDATE * 3))); do
  api=$(curl -s localhost:3200/api/read | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).value))')
  page=$(curl -s localhost:3200/ | grep -o '<p id="value">[^<]*' | sed 's/.*>//')
  now=$(node -e 'console.log(Date.now())')
  echo "t+$(( (now - t0) / 1000 ))s api=$api page=$page"
  [ "$api" = w1 ] && [ "$page" = w1 ] && break
  sleep 1
done
kill "$server" 2>/dev/null; wait "$server" 2>/dev/null
for p in $(lsof -ti tcp:3200 -sTCP:LISTEN); do kill "$p"; done
