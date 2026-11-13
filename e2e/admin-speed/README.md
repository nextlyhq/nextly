# Admin speed counts

How much a production start and the admin's main screens cost, counted on
SQLite, PostgreSQL and MySQL against the playground's production build, and
held to the numbers in `pins.json`. The `Admin speed` workflow runs it on every
pull request that touches the packages, the playground or the templates.

```sh
pnpm build                                        # the packages, first
pnpm --filter @nextlyhq/e2e test:admin-speed      # build the playground, count, compare
node e2e/admin-speed/measure.mjs --build --dialects sqlite --no-growth   # one dialect, quicker
node e2e/admin-speed/measure.mjs --dialects sqlite --no-growth   # again, on the same build
```

What it counts, for each dialect:

- **start** — the statements a production start sends, from the moment the
  admin page is first asked for until the database has been quiet for four
  seconds (the work a start leaves running included);
- for the sign-in screen, signing in, and the dashboard, a collection list and an
  entry's edit page, each in a fresh tab: the admin API **requests**, the
  **rounds** (the longest chain of requests each sent after an earlier one
  answered), and the **statements** sent while the screen loads.

Beside those counts it reports, for each screen and never against a pin, how
many milliseconds after the load began the startup request was sent
(`timings`, the middle of the five loads): the admin sends it as the browser
reads the page, so a later start is a slower screen even when no count moves.
`timings` also carries the most statements any of the five loads sent
(`mostStatements`). The pins hold the fewest, which a burst in one load does
not move, so the most is what shows one: requests arriving together each
reading what one read would have answered.

On PostgreSQL it also starts the server with every round trip held 100 ms, and
with 45 more collections, and pins how many statements each adds to the start
(`growth`). A start whose work is fixed adds none.

`preload.mjs` does the counting: loaded into the server with `node --import`,
it wraps the database drivers the adapters load, logs each statement, and holds
it for `NEXTLY_SPEED_DB_DELAY_MS` when asked.

`racy` in the pins names, screen by screen, the requests that screen is known
to send a varying number of times: two parts of it racing to ask for the same
thing, or a timer firing near the end of a load. On that screen their number
may move, and they may come and go between every load and only some; on every
other screen they are held like any request. Remove each one as its duplicate is
fixed.

## When it fails

- **Above its pin**: the change made the admin or the start more expensive.
  Find the new request or statements, or, when the cost is deliberate, raise the
  pin in the same pull request and say why.
- **Below its pin**: the change made it cheaper. Lower the pin with
  `--update-pins` (run on all three dialects) so the gain is kept.
- **Admin page first byte above its limit**: on the PostgreSQL start with every
  round trip delayed, the admin page answered more than a second after the
  server's first answer to a page that needs nothing (or more than ten seconds
  after it began listening; a start that holds the page takes about a hundred).
  The page is prebuilt and needs no database, so something made it wait: a
  `register()` that waits for Nextly to start, or the admin route doing work for
  each request again. With `--build`, the databases these start-only runs use
  are prepared before the build, as a deploy migrates and then builds: one
  seeded after the build has changed every page that reads it, and the
  playground's admin reads site code in its root layout, so its build copy
  would no longer stand and the page would be rendered while the start runs.
  Without `--build`, those databases are newer than the build that serves them.
- **Admin page sent different pages, or forbids keeping it**: two fetches of
  `/admin` with no session, once the start is quiet, must get the same bytes and
  headers a shared cache may keep. The admin route is no longer prebuilt.

Each counted load begins at least 2.5 s after the last admin request. The
server reads the stored schema version at most once every 2 s and the RBAC
epoch at most once a second, so a load begun sooner reuses the previous load's
reads, and its count would turn on how fast that load ended; after the gap,
every load pays both reads, as a visit arriving cold does.

Each screen is loaded five times, and its requests are pinned by kind (method
and path, with ids made generic), each kind counting the fewest times any of
the five loads sent it. Some requests are sent more often in some loads than
others, such as one sent twice when two parts of a screen race to ask for it;
the fewest drops those extra copies. A kind that some loads did not send at
all is listed as `occasional` and not counted; if every load starts sending
it, that is a new request, unless the screen lists it as `racy`. A request the admin always sends is in every load, so a new one
fails by its name and one more of a kind fails by its number. Statements and rounds
are likewise the fewest any load took, since an extra copy of a request sends
its own statements and one slow answer can add a round. A start's statements
and a screen's may move by 5% (`STATEMENT_SLACK`), and rounds by one.

It serves on port 3103, or `ADMIN_SPEED_PORT`, and refuses to start when that
port is already taken.

Each PostgreSQL and MySQL run creates and drops a database of its own on the
server `E2E_DB_SERVER_URL_POSTGRESQL` or `E2E_DB_SERVER_URL_MYSQL` names, or on
the local test containers by default.
