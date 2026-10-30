# Out-of-request expiry lab

A minimal Next.js app on the workspace's Next.js, measuring how a write made
outside a request can expire cached reads, on one instance and on two.

- `lib/read.ts`: an `unstable_cache` read tagged `item`, as nextly's reads are;
  `lib/read-use-cache.ts`: the same under `use cache`. `app/page.tsx` is a page
  prerendered from the first, so its stored render is measured too.
- `app/api/write`: a write inside a request, then `revalidateTag`.
- `app/api/expire`: mechanism b, an authenticated route a writer calls with
  its tags.
- `LAB_REVALIDATE`: mechanism a, a lifetime on every cached read.
- `cache-handler.mjs` (incremental cache) and `use-cache-handler.mjs`
  (`cacheHandlers`): entries per instance, tag expiries in a ledger shared by
  every instance and writer. The ledger is a JSON file standing in for a table
  in the app's database.
- `cli.mjs`: a writer with no Next.js runtime, with `--expire` (call the route
  on each instance) or `--ledger` (record the expiry only).
- `instrumentation-node.ts` with `LAB_TIMER=1`: a write inside the server
  process but outside any request.

Run from this folder, after `pnpm install` at the repository root, with
`next`, `react`, `react-dom`, `typescript` and `@types/{react,node}` linked into
`node_modules` from `apps/playground/node_modules`:

```sh
./drive-single.sh                    # one instance: in-request, CLI, route, timer
LAB_REVALIDATE=10 ./drive-lifetime.sh # mechanism a: time until a reader sees a write
LAB_SHARED_LEDGER=0 ./drive-multi.sh  # two instances, Next.js's default cache
LAB_SHARED_LEDGER=1 ./drive-multi.sh  # two instances sharing the ledger handlers
```

The scripts use ports 3200 and 3203.
