#!/bin/bash
# Two instances, each with its own copy of the build, as two containers would
# have. LAB_SHARED_LEDGER=1 builds with the ledger cache handler; 0 with Next's
# default cache. Each write is followed by a read of both instances.
set -u
L=$(cd "$(dirname "$0")" && pwd)
export LAB_DATA=$L/run/data.json LAB_LEDGER=$L/run/ledger.json LAB_SECRET=lab-secret NEXT_TELEMETRY_DISABLED=1
export LAB_SHARED_LEDGER=${LAB_SHARED_LEDGER:-0} LAB_PORTS=3200,3203
unset LAB_REVALIDATE LAB_TIMER
rm -rf "$L/.next" "$L/run/b"; echo '{"value":"v0","writtenAt":0}' >| "$LAB_DATA"; echo '{}' >| "$LAB_LEDGER"
(cd "$L" && ./node_modules/next/dist/bin/next build > "$L/run/build-multi.log" 2>&1) || { echo "build failed"; tail -20 "$L/run/build-multi.log"; exit 1; }
mkdir -p "$L/run/b" && (cd "$L" && cp -R .next next.config.mjs package.json cache-handler.mjs use-cache-handler.mjs node_modules "$L/run/b/")
pids=()
start() { (cd "$1" && exec ./node_modules/next/dist/bin/next start -p "$2") > "$L/run/server-$2.log" 2>&1 & pids+=($!)
  for _ in $(seq 1 60); do curl -s -o /dev/null "localhost:$2/api/read" && return; sleep 0.5; done; echo "no server on $2"; exit 1; }
value_on() { curl -s "localhost:$1/api/read" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).value))'; }
page_on() { curl -s "localhost:$1/" | grep -o '<p id="value">[^<]*' | sed 's/.*>//'; }
uc_on() { curl -s "localhost:$1/api/read-uc" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).value))'; }
both() { echo "  A: api=$(value_on 3200) page=$(page_on 3200) use-cache=$(uc_on 3200)   B: api=$(value_on 3203) page=$(page_on 3203) use-cache=$(uc_on 3203)"; }
start "$L" 3200; start "$L/run/b" 3203
echo "shared ledger=$LAB_SHARED_LEDGER, warm:"; both; both
curl -s -X POST localhost:3200/api/write -H 'content-type: application/json' -d '{"value":"v1"}' >/dev/null
echo "in-request write of v1 through A:"; both
node "$L/cli.mjs" v2 --expire
echo "CLI write of v2, then the expire route on both:"; both
if [ "$LAB_SHARED_LEDGER" = 1 ]; then
  node "$L/cli.mjs" v3 --ledger
  echo "CLI write of v3, recording the expiry in the ledger only:"; both
  node "$L/cli.mjs" v4
  echo "control: CLI write of v4 with no expiry at all (both must still serve v3):"; both
fi
for p in "${pids[@]}"; do kill "$p" 2>/dev/null; wait "$p" 2>/dev/null; done
for p in $(lsof -ti tcp:3200 -sTCP:LISTEN) $(lsof -ti tcp:3203 -sTCP:LISTEN); do kill "$p"; done
