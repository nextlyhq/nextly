# Builder speed

How long the page builder makes an author wait, measured in a real browser on
the playground's production build with the processor slowed 4×, and held to
the budgets in `budgets.mjs`. The `Builder speed` workflow runs it on every
pull request that touches `builder`, `blocks-react`, `blocks-engine`,
`plugin-page-builder`, the playground or this check.

```sh
pnpm build                                         # the packages, first
pnpm --filter @nextlyhq/e2e test:builder-speed     # build the playground, seed, measure
node e2e/builder-speed/measure.mjs                 # again, on the last build
node e2e/builder-speed/measure.mjs --keep          # ...and leave the server up
node e2e/builder-speed/measure.mjs --base-url http://localhost:3104 --samples 3 --only undo,add-panel-insert
node e2e/builder-speed/measure.mjs --base-url https://<preview> --rate 1   # a deployed site, no slowdown
```

Options: `--build` builds the playground first; `--rate <n>` sets the
processor slowdown (4 by default; 1 measures without slowing, as a real slow
laptop needs no emulated slowdown); `--samples <n>` sets the samples per
timing (10); `--only <id,id>` measures only those budgets and skips the rest;
`--json <file>` sets where the results go
(`e2e/.playwright/builder-speed/results.json`). With `--base-url` it measures
a running server whose database already holds the fixture, signing in as
`BUILDER_SPEED_EMAIL` / `BUILDER_SPEED_PASSWORD` (the playground's seeded user
by default); without it, it starts its own server on `BUILDER_SPEED_PORT`
(3104) with a fresh SQLite database.

## Files

- `measure.mjs`: the command, which runs each group of measures and judges
  them;
- `budgets.mjs` and `expected-failures.mjs`: the budgets, and today's known
  misses, one line each;
- `report.mjs`: the judgement and the table (its unit test is
  `scripts/builder-speed-report.test.mjs`);
- `editing.mjs` and `session.mjs`: the measures themselves;
- `browser.mjs`, `page-agent.mjs`, `server.mjs` and `config.mjs`: the timing
  probe and browser helpers, what runs inside the page, the server it starts,
  and its settings;
- `long-session.mjs` and `long-session-report.mjs`: the long editing session
  below, and its judgement (its unit test is
  `scripts/builder-long-session-report.test.mjs`).

## The pages it measures

`apps/playground/seed/speed-fixture.ts`, seeded by
`apps/playground/scripts/seed-speed-fixture.ts` after the playground's own
seed, on SQLite, PostgreSQL or MySQL (whatever `DB_DIALECT` and
`DATABASE_URL` name). A 150-block page shaped like a real marketing page (a
hero, logos, feature cards, a card component placed six times, a list of
posts, testimonials, an accordion, a form, pricing, figures, a story, a
closing band and a gallery), drawn inside a Layout whose header and footer
carry images and buttons; and pages of 4, 20 and 38 blocks for the size
curve. Every block id is fixed, so the script clicks the same blocks on every
run. The seed puts the pages back to this shape each time it runs, since the
script edits and publishes them.

## The method

- **Production build only.** The dev server is several times slower and
  holds more memory; a budget measured there means nothing.
- **"Visible"** is the time from the input event (its own timestamp) to the
  first animation frame in which the result is on screen: a check runs in
  every frame and finds it there.
- **Each timing is the 75th percentile of 10 samples** on the 150-block page.
  A count whose budget is none is the most any sample saw.
- **React commits** are counted through a stand-in for the React DevTools
  hook, which a production build reports to. **Requests** are the admin API
  requests the page sends; a selection's are those from the click until 1.5 s
  after its result showed, lock renewals (on a timer) left out. **Statements**
  (reported, not budgeted) come from `../admin-speed/preload.mjs`, loaded into
  the server the script starts.
- **Header and footer elements hidden by an insert**: in every frame from the
  click, how many elements inside the Layout's regions are drawn with no size,
  beyond those drawn with none before; the most in any one frame.
- **Footer size changes**: a `ResizeObserver` on the footer region while the
  pointer rests 10 px inside its top edge for five seconds.
- **Typing**: a keystroke is timed until the canvas shows the new text (read
  as not shown after 3 s), then Tab is timed until the canvas shows it. Once
  the canvas follows typing, the Tab row still counts the work leaving the
  field does in its own handlers, since the first frame after the key waits
  for them.
- **Publish** is timed from the click on the editor's primary action to the
  save request leaving the page, and to the editor showing the page saved
  with nothing left to save, after that request was answered.
- **Open the builder** is timed from the click on "Open in builder" on the
  page's edit screen (an in-app navigation, with the admin's code already
  loaded, as an author usually arrives) to the canvas drawing the first
  block, with 150 ms added to every request (CDP's network emulation). The
  requests and round trips are the admin API's (`/admin/api/`), read on the
  page's own clock; round trips are the longest chain of them in which each
  began after an earlier one was answered.
- **Heap growth** is read after a forced garbage collection, with the
  processor not slowed: a slowdown changes how long the 250 actions take, not
  what they keep.

## When it fails

- **A budget missed**: the change made the builder slower for an author. The
  line names the measure, the result and the budget; the JSON file has every
  sample, and a screenshot is saved beside it when a step could not finish.
- **A known miss passes** ("remove its mark"): the change fixed it. Delete
  its line from `expected-failures.mjs` with the fix, so the gain is held
  from then on.
- **Not measured**: a step could not finish (an element never showed). The
  reason and a screenshot are in `e2e/.playwright/builder-speed/`.

The budgets themselves are the product's targets. Changing one changes what
the builder promises, so it is done on purpose, with the reason stated.

## The long session

Half an hour of an author's ordinary editing on the 150-block page, on the
same production build and server, with the processor slowed 4×. The
`Builder long session` workflow runs it nightly, on demand, and on a pull
request that changes the session itself; not on every pull request, since it
takes half an hour.

```sh
pnpm --filter @nextlyhq/e2e test:builder-long-session   # build, seed, 30 minutes
node e2e/builder-speed/long-session.mjs --minutes 3     # a short try, on the last build
node e2e/builder-speed/long-session.mjs --base-url http://localhost:3000 --rate 1
```

One round of editing is two selections, the sidebar's Style tab and back to
Content, a text edit taken back again, an insert from the Add panel and its
undo, and the pointer swept over the blocks in view; rounds repeat until the
time is up. It records every long task on the main thread, and once a
minute the heap (after a forced garbage collection, whose own task is left
out), the DOM nodes and event listeners, and the editor's lock notice if it
shows one; and the median selection time at the start and at the end.

It fails when a main-thread task runs longer than 1 s after the first
minute, or the editor's lock notice offers to take the document back (the
lock was lost). The results, with every long task and every reading, go to
`e2e/.playwright/builder-speed/long-session.json` (`--json` to change it).

## The counters

What a counter can say, a unit test says instead of a timing, so it cannot
flake on a slow machine: `packages/builder/src/speed-counters.test.tsx` (the
header and footer drawn again per selection, hover and insert; the site's
stylesheet compiled per selection and hover; the page drawn per selection and
hover with the canvas's own inputs held steady; whole-document walks per
selection; trial inserts when the Add panel opens) and
`packages/plugin-page-builder/src/admin/speed-counters.test.tsx` (the page
drawn per selection in the page builder's own editor, where the canvas is
handed what the editor really hands it; the builder's file holds the canvas's
inputs steady, so its counts are the canvas's own work). Each budget is none.
Today's misses use `expectKnownMiss`, which holds the count above its budget:
it turns red when the work is gone, and the fix swaps it for the budget's
assertion. Unlike `it.fails`, a case that breaks for another reason fails
instead of passing as "still slow".
