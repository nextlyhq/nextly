# Browser tests

The admin, driven in a real browser, against a real Next.js server and a real
database.

```bash
pnpm --filter @nextlyhq/e2e exec playwright install chromium   # once
pnpm --filter @nextlyhq/e2e test:e2e
```

Nothing else to set up. The suite starts its own playground and stops it again.

## Why this exists alongside Vitest

It is not a replacement for anything. The unit and integration suites are the
right tool for almost everything, and they cover far more than this does.

The gap is that **jsdom has no layout engine**. `getBoundingClientRect()`
returns zeros, and computed styles are not cascaded. So an entire class of
defect is not "untested" but _untestable_ there:

| Defect that shipped                                                                    | Why a unit test could not see it                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| The Name column reached 1024px, pushing the first checkbox 1076px away                 | jsdom reports every width as 0                                  |
| Checkbox outlines measured 1.35:1 and 1.14:1 against a 3:1 requirement                 | jsdom does not cascade CSS                                      |
| A missing column 500'd every request; the admin's retry looked like an infinite reload | needs a real server, a real database and a real browser at once |

So: Vitest for logic and services, this for what only a browser knows.

## What it will not cover

- **Signing in.** The playground's `admin.devAutoLogin` issues a session for
  `dev@nextly.local` on the first `/admin` visit, and the playground cannot
  render auth pages at all. Anything about login, invites or password reset
  needs a real app.
- **Postgres or MySQL.** This runs on sqlite. Dialect differences belong to the
  integration suite, which already runs against all three.

## Safety

The suite writes to a database it owns and empties: `apps/playground/data/e2e.db`,
recreated before every run, never the `nextly.db` your `pnpm dev:app` uses. That
is why a test here is allowed to delete things — there is nothing in it anyone
wanted. It is deliberate, and it exists because a probe against the development
database once deleted a real media file, row and file both.

It also runs on **port 3100** with its own build directory (`.next-e2e`), so it
does not disturb a dev server on 3000. Separate ports alone are not enough:
two `next dev` processes on one app fight over `.next`, and the second one dies.

## Layout

```
e2e/
  playwright.config.ts    the server, the database, the port
  global-setup.ts         signs in once, hands the session to every test
  scripts/                empties the database before the server opens it
  tests/
    support/admin.ts      navigation, theming, contrast maths
    *.spec.ts
```

It lives at the repo root rather than under `packages/` or `apps/` because it
tests neither a package nor an app: it tests the composed product — playground,
admin, core and plugins together.

## Writing a test here

Only if the other layers cannot. A test belongs here when it needs **real
layout, real navigation, or a real server and database at once**. If it can be
written in Vitest, write it there: it will run in a tenth of the time, and this
suite is only useful while it stays fast enough that people run it.

Use `gotoAdmin(page, path, theme)` from `tests/support/admin.ts` rather than
`page.goto`. It waits for the admin to actually draw a screen — the root div is
served empty and filled on hydration, so it exists long before there is anything
in it — and pins the theme, which otherwise follows whatever the CI machine
feels like.

## Known trip-hazards

- **`localhost`, never `127.0.0.1`.** Dev auto-login issues no session for
  `127.0.0.1`, and the admin then renders an empty shell forever while every
  test times out waiting for a screen that is waiting to know who you are.
- **There are two `.nextly-admin` elements.** A strict locator cannot resolve
  them. Wait on `main`.
- **The theme class lives on `.nextly-admin.dark`, not `html.dark`.** An effect
  copies it down after mount, so setting `html.dark` by hand changes nothing
  and measures nothing.
- **Console errors are not a failure signal.** Dev mode reports its own HMR
  socket, and the dashboard feature-detects seeding with a `HEAD` it expects to
  fail. Assert on 5xx responses and uncaught exceptions instead.
