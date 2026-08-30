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

# Wait for the server, as the workflow does. Authoring immediately races a cold
# start, and the first CSRF fetch then fails on a refused connection rather than
# on anything about the page.
until curl -sf http://localhost:3111/api/health > /dev/null; do sleep 1; done

node scripts/lighthouse/author-dogfood-page.mjs
npx @lhci/cli@0.15.1 autorun --config=scripts/lighthouse/lighthouserc.json
npx @lhci/cli@0.15.1 autorun --config=scripts/lighthouse/lighthouserc.mobile.json
```

On macOS, point Lighthouse at a browser first:
`export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

Start from a fresh database file rather than reseeding an existing one. The seed
exits early when the dev user already exists — `seed skipped (users-exist)` —
so it will not restore media, or anything else, into a database that has been
partly emptied. The workflow gets this for free by running on a clean checkout.

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

Set against a CI run rather than a laptop, because the runner is what the
nightly measures on:

|                 | measured | ceiling | headroom                |
| --------------- | -------- | ------- | ----------------------- |
| script requests | 5        | 8       | room for a chunk or two |
| script bytes    | 148,056  | 165,000 | 11%                     |
| total bytes     | 206,368  | 230,000 | 11%                     |

The byte figures carry about a tenth of headroom because they are deterministic
per build — the payload does not vary between runs the way a timing does — so a
tight ceiling costs no flakiness and catches a regression the run it arrives in.
The request count is looser in proportion because one legitimate new chunk is a
whole unit rather than a percentage.

**Re-set them whenever the floor moves on purpose.** They were 30 / 1,000,000 /
1,100,000 while the page still carried the contributor harness's client shell;
leaving them there after that shell came off would have let the payload grow
back to six times its size without the night noticing.

---

## Baseline

Recorded 2026-08-30 from a CI run of this exact fixture, **not from a laptop** —
the runner is what the nightly measures on. **Every figure below is a property
of the conditions listed with it**, and the fixture is a file that changes: a
number here describes the document as it stood when the number was taken, so
re-record whenever the fixture is edited rather than assuming the conditions
still hold.

| condition            | value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| page                 | `http://localhost:3111/` — the `homepage` Single, field `layout`             |
| document             | `scripts/lighthouse/dogfood-page.json` — 22 nodes, 2 images, one 3-item list |
| route classification | `ƒ Dynamic — server-rendered on demand`                                      |
| server               | `next build` + `next start`, `NODE_ENV=production`, SQLite                   |
| Lighthouse           | 12.6.1, via `@lhci/cli` 0.15.1                                               |
| browser              | HeadlessChrome 151                                                           |
| throttling           | `simulate`                                                                   |
| host                 | `ubuntu-latest` GitHub runner                                                |

| metric                               | desktop (5 runs)  | mobile (3 runs) |
| ------------------------------------ | ----------------- | --------------- |
| Performance                          | **100** (100–100) | **99** (99–99)  |
| Accessibility / Best Practices / SEO | 100               | 100             |
| FCP                                  | 216 ms            | 767 ms          |
| LCP                                  | 493 ms            | 2179 ms         |
| TBT                                  | 0 ms              | 47 ms           |
| TTI                                  | 495 ms            | 2218 ms         |

### Payload

| resource   | requests | transferred       |
| ---------- | -------- | ----------------- |
| Script     | 5        | 148,056 bytes     |
| Stylesheet | 1        | 2,754 bytes       |
| **Total**  | **10**   | **206,452 bytes** |

The whole presentation layer — every block default and the site sheet — is those
2,754 bytes.

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
