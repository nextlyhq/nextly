# Lighthouse: the dogfood page

The nightly workflow (`.github/workflows/lighthouse.yml`) measures one page: the
playground's `/`, rendered from a block document authored through the same admin
API the editor writes with, served by a production build, fetched as a signed-out
visitor.

## What runs

1. Seed the playground — creates the user the authoring step signs in as and the
   media library the fixture resolves its images against.
2. `next build` and `next start` on port 3111 with their own database and build
   directory.
3. `author-dogfood-page.mjs` writes `dogfood-page.json` into the `homepage`
   single and fails if the result is not served to an anonymous visitor.
4. `lighthouserc.json` — five desktop runs, asserted. This one gates.
5. `lighthouserc.mobile.json` — three mobile runs, recorded as a warning. This
   one never gates.

## Reproducing it locally

```sh
pnpm build
export DB_DIALECT=sqlite DATABASE_URL="file:./data/lighthouse.db"
export NEXT_DIST_DIR=".next-lighthouse"
export NEXTLY_SECRET="lighthouse-nightly-secret-not-a-real-deployment-key"
export NEXT_PUBLIC_APP_URL="http://localhost:3111"

pnpm --filter playground exec tsx scripts/seed.ts
pnpm --filter playground exec next build
PORT=3111 pnpm --filter playground exec next start &

node scripts/lighthouse/author-dogfood-page.mjs
npx @lhci/cli@0.15.1 autorun --config=scripts/lighthouse/lighthouserc.json
npx @lhci/cli@0.15.1 autorun --config=scripts/lighthouse/lighthouserc.mobile.json
```

On macOS, point Lighthouse at a browser first:
`export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

## Why desktop gates and mobile only records

The same page scores 99 on the desktop preset and 79–91 on the mobile one, and
the mobile figure moves between collections on a machine doing other work while
the desktop figure does not. Gating on the unstable number would produce a red
night for a reason nobody can act on; dropping the mobile number entirely would
hide the gap. So the mobile profile runs, warns, and is uploaded with the rest.

## Why the assertions say `aggregationMethod: median`

Left to its default, a Lighthouse CI assertion aggregates multiple runs
_optimistically_ — it resolves to the value most likely to pass, which is the
best run. A five-run gate on the default only fails when all five runs fail.
Against the same five collected runs, `minScore: 0.999` resolves to `1` and
passes under the default, and to `0.99` and fails under `median`.

## Why the script and byte ceilings are where they are

They sit just above what the page transfers today, so the payload cannot grow
without the night going red. They are a ratchet rather than a target: the number
they are set against is the measured present, not a budget anybody chose.

---

## Baseline

Recorded 2026-08-29. **Every figure below is a property of the conditions listed
with it.** A score without them is not comparable to anything.

| condition            | value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| page                 | `http://localhost:3111/` — the `homepage` Single, field `layout`       |
| document             | `scripts/lighthouse/dogfood-page.json`, 2 sections, 16 nodes, 2 images |
| route classification | `ƒ Dynamic — server-rendered on demand` (per `next build`)             |
| server               | `next build` + `next start`, `NODE_ENV=production`, SQLite             |
| Lighthouse           | 12.6.1, via `@lhci/cli` 0.15.1                                         |
| browser              | HeadlessChrome 151.0.0.0                                               |
| throttling           | `simulate`                                                             |
| host                 | Apple Silicon laptop, load average 7.5, **not a CI runner**            |

### Desktop preset — 5 runs, this is what gates

| metric         | median  | range     |
| -------------- | ------- | --------- |
| Performance    | **99**  | 99–99     |
| Accessibility  | 100     | 100–100   |
| Best Practices | 100     | 100–100   |
| SEO            | 100     | 100–100   |
| FCP            | 244 ms  | 244–245   |
| LCP            | 1033 ms | 1032–1035 |
| TBT            | 8.5 ms  | 6–9       |
| CLS            | 0       | 0–0       |
| TTI            | 1302 ms | 1295–1303 |

### Mobile preset — 3 runs, recorded only

| metric      | median  | range     |
| ----------- | ------- | --------- |
| Performance | **79**  | 79–79     |
| FCP         | 904 ms  | 904       |
| LCP         | 5484 ms | 5483–5484 |
| TBT         | 105 ms  | 102–114   |
| TTI         | 7024 ms | 7017–7039 |

An earlier collection on the same build, on a less busy machine, scored mobile
performance 90–91 with LCP 3.4 s. The desktop figure did not move between those
collections. That difference is the reason the mobile number is not gated.

### On a GitHub-hosted runner

The figures above come from a laptop. The same harness on `ubuntu-latest`:

|                  | result                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- |
| desktop, gated   | every assertion passed — performance, the three category floors, and the script/byte ceilings |
| mobile, recorded | median **0.84** (runs: 0.77, 0.84, 0.82)                                                      |

So the desktop floor is reachable on the runner the nightly actually uses, and
the mobile figure is lower there than on any local collection — which is the
second reason it is recorded rather than gated.

### Payload

| resource   | requests | transferred       |
| ---------- | -------- | ----------------- |
| Script     | 27       | 910,121 bytes     |
| Image      | 2        | 46,748 bytes      |
| Stylesheet | 2        | 21,112 bytes      |
| Document   | 1        | 9,118 bytes       |
| **Total**  | **33**   | **988,023 bytes** |

`unused-javascript` scores 0 on this page, with an estimated 461 KiB of savings.

### What this baseline does NOT measure

The playground's root layout is a client component that mounts the admin's
command palette, theme provider, query provider and error boundary on every
route, public ones included. The scaffold templates do not do this. So the 910 KB
of script above is a property of the contributor harness, not of a page a
Nextly site serves.

Measured by rebuilding with a plain server-component root layout — same database,
same authored document, same toolchain, and the rendered content verified
identical:

|                              | scripts | script bytes | total bytes | desktop | mobile |
| ---------------------------- | ------- | ------------ | ----------- | ------- | ------ |
| as shipped                   | 27      | 910,121      | 987,781     | 99      | 91     |
| server-component root layout | 5       | 148,056      | 221,197     | 100     | 100    |

Until that difference is closed, this baseline tracks the dogfood app, and the
right reading of a change in it is "the harness moved", not "Nextly got slower".
