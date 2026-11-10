# Admin speed counts

How much a production start and the admin's main screens cost, counted on
SQLite, PostgreSQL and MySQL against the playground's production build, and
held to the numbers in `pins.json`. The `Admin speed` workflow runs it on every
pull request that touches the packages, the playground or the templates.

```sh
pnpm build                                        # the packages, first
pnpm --filter @nextlyhq/e2e test:admin-speed      # build the playground, count, compare
node e2e/admin-speed/measure.mjs --dialects sqlite --no-growth   # one dialect, quicker
```

What it counts, for each dialect:

- **start** — the statements a production start sends, from the moment the
  admin page is first asked for until the database has been quiet for four
  seconds (the work a start leaves running included);
- for the sign-in screen, signing in, and the dashboard, a collection list and an
  entry's edit page, each in a fresh tab: the admin API **requests**, the
  **rounds** (the longest chain of requests each sent after an earlier one
  answered), and the **statements** sent while the screen loads.

On PostgreSQL it also starts the server with every round trip held 100 ms, and
with 45 more collections, and pins how many statements each adds to the start
(`growth`). A start whose work is fixed adds none.

`preload.mjs` does the counting: loaded into the server with `node --import`,
it wraps the database drivers the adapters load, logs each statement, and holds
it for `NEXTLY_SPEED_DB_DELAY_MS` when asked.

`racy` in the pins names the requests the admin is known to send a varying
number of times, two parts of a screen racing to ask for the same thing. Their
number may move; whether they are sent at all may not. While any are listed, a
screen's statements may move by 15% rather than 5%. Remove each one as its
duplicate is fixed.

## When it fails

- **Above its pin**: the change made the admin or the start more expensive.
  Find the new request or statements, or, when the cost is deliberate, raise the
  pin in the same pull request and say why.
- **Below its pin**: the change made it cheaper. Lower the pin with
  `--update-pins` (run on all three dialects) so the gain is kept.

Each screen is loaded five times, and its requests are pinned by kind (method
and path, with ids made generic), each kind counting the fewest times any of
the five loads sent it. Some requests are sent more often in some loads than
others, such as one sent twice when two parts of a screen race to ask for it;
the fewest drops those extra copies. A kind that some loads did not send at
all (one a timer fires near the end of a load) is listed as `occasional` and
not counted. A request the admin always sends is in every load, so a new one
fails by its name and one more of a kind fails by its number. Statements and rounds
are likewise the fewest any load took, since an extra copy of a request sends
its own statements and one slow answer can add a round; statements may move by
5% and rounds by one.

Each PostgreSQL and MySQL run creates and drops a database of its own on the
server `E2E_DB_SERVER_URL_POSTGRESQL` or `E2E_DB_SERVER_URL_MYSQL` names, or on
the local test containers by default.
