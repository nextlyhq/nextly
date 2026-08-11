/**
 * Screenshots every theme lab theme across the admin's main screens in both
 * modes.
 *
 * Themes are applied by writing the same localStorage keys the switcher and
 * ThemeProvider use and then navigating, rather than by clicking the panel,
 * so a change to the panel's markup cannot silently break a capture run:
 *
 *   - `nextly-theme-lab` holds the full `{ theme, density }` selection
 *     `useThemeLab` persists (src/theme-lab/use-theme-lab.ts). Writing only
 *     `{ theme }` would drop density back to whatever the last write left it
 *     at instead of the theme's own recommendation.
 *   - `nextly-theme` is next-themes' own storage key (configured in
 *     packages/admin/src/context/providers/ThemeProvider.tsx), holding the
 *     plain string "light" or "dark" -- not JSON, and not the theme lab's
 *     key. next-themes reads it from an inline script it injects before
 *     hydration, so a full navigation is enough to pick up a change; nothing
 *     here needs to call location.reload() directly.
 *
 * Every `page.goto` is therefore a real browser navigation (not a client-side
 * transition), which is what makes a plain localStorage write before it take
 * effect. After navigating, the script waits for `.nextly-admin`'s
 * `data-theme` and `dark` class to actually match what was just requested
 * before screenshotting -- confirming the theme applied rather than assuming
 * a load event implies it did.
 *
 * The admin fetches its data client-side after hydration (React Query), so
 * `waitForLoadState("networkidle")` resolves while a screen is still showing
 * its loading skeleton -- the network has genuinely gone quiet, it just went
 * quiet before the fetched rows finished rendering. Each screen below has its
 * own explicit real-content check instead: dashboard/media/users/settings
 * route their loading state through the shared `<Skeleton>` component
 * (`packages/ui/src/components/skeleton.tsx`, `data-slot="skeleton"` on every
 * placeholder div), so waiting for zero of those is conclusive. Collections
 * and builder render their tables' loading state with a local, unmarked
 * `animate-pulse` div instead (`EntryTableSkeleton.tsx` / `CollectionTableSkeleton`),
 * so those two wait for a specific piece of real, seeded text instead --
 * chosen to not collide with the sidebar's own static nav labels ("Posts",
 * capitalized, vs. the table's lowercase slug text "posts"; "Collections" as
 * a nav label vs. a seeded post's actual title). Every screen also waits for
 * the skeleton count first, since the sidebar's own user-footer widget loads
 * asynchronously on every route and would otherwise leave that corner of the
 * screenshot stale. A screen that never reaches ready within `READY_TIMEOUT`
 * throws, naming the theme/screen/mode, rather than silently capturing
 * whatever was on screen at timeout.
 *
 * Counts are derived from NEXTLY_THEMES / TWEAKCN_THEMES at run time and
 * logged at the end rather than asserted anywhere, so this script does not
 * go stale the next time a theme is added or retired.
 *
 * Run with the playground already serving on :3000:
 *   pnpm theme:capture -- [--all-tweakcn] [--only id1,id2] [--screens name1,name2]
 *
 * `--only` and `--screens` restrict the run to specific theme ids / screen
 * names (both match against the values below) and exist for smoke-testing a
 * small slice before committing to the full pass, which takes a while.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = resolvePath(here, "../.theme-captures");

const { NEXTLY_THEMES, TWEAKCN_THEMES } = await import(
  "../src/theme-lab/themes/index.ts"
);

const BASE = "http://localhost:3000";

// Verified against the running playground: `/admin/collections` on its own
// is a smart redirect that picks the most recently created record across
// collections (and can 404 on an empty database), not a stable page to
// screenshot. A concrete slug is a real, direct route instead.
const FULL_SCREENS = [
  ["dashboard", "/admin"],
  ["collections", "/admin/collections/posts"],
  ["media", "/admin/media"],
  ["users", "/admin/users"],
  ["settings", "/admin/settings"],
  ["builder", "/admin/builder/collections"],
];
const BRIEF_SCREENS = FULL_SCREENS.slice(0, 2);

const READY_TIMEOUT = 20_000;

/**
 * Per-screen proof that real data rendered, not a loading skeleton. Verified
 * against the actual admin source rather than guessed:
 *
 *   - dashboard/media/users/settings: every widget on these routes gates its
 *     loading state on the shared `<Skeleton>` (data-slot="skeleton"), so
 *     absence of that marker is enough. Confirmed each also imports it --
 *     CollectionQuickLinks.tsx / TeamSummary.tsx / SinglesQuickLinks.tsx
 *     (dashboard), MediaLibrarySkeleton (media), UserTable.tsx (users),
 *     GeneralSettingsSkeleton (settings) -- not assumed from the route name.
 *   - collections/users/builder: all three route through the shared
 *     `DataTableView` (packages/admin/src/components/ui/table/data-table/),
 *     whose own loading state (`EntryTableSkeleton.tsx` /
 *     `CollectionTableSkeleton`) is a local `animate-pulse` div, not the
 *     shared component, so the skeleton-count check can't see it. These wait
 *     for specific seeded text instead: a real post title for collections
 *     (apps/playground/seed/seed-data.json has 5 seeded posts; "Welcome to
 *     Nextly Playground" is the published one, least likely to be affected by
 *     a future seed edit to the drafts), the seeded dev user's email for
 *     users, and the "posts" collection's slug subtext for builder --
 *     deliberately lowercase to avoid matching the sidebar's own "Posts" nav
 *     label, which renders immediately regardless of whether the table has
 *     loaded.
 *
 * `DataTableView` renders BOTH a desktop table and a `@md/table:hidden`
 * mobile card list for the same rows (a container-query breakpoint, not a
 * media query, so it's still in the DOM and matches `getByText` even though
 * `display: none` hides it at this script's 1440px viewport). Every seeded-
 * text check below is intersected with Playwright's own `:visible` selector
 * so a match against the hidden mobile duplicate can't stand in for the row
 * that's actually on screen -- confirmed live: without this, `.first()`
 * resolved to the hidden card copy every time, so the wait technically
 * "passed" while the visible half of the DOM was still on its skeleton.
 *
 * Every screen also waits for the skeleton count to hit zero first: the
 * sidebar's user-footer widget fetches the current user independently of
 * whatever the main content area is doing, on every route, so skipping this
 * for collections/users/builder would leave that corner of the frame stale
 * even though the table itself is ready.
 */
/**
 * The first name the dev seed gives its user (`scripts/seed.ts`: "Dev User").
 *
 * `WelcomeHeader` renders `getFirstName(user?.name)`, which is "there" when
 * the user request failed. Waiting for THIS name is what separates a loaded
 * dashboard from a failed one.
 */
const SEEDED_FIRST_NAME = "Dev";

/**
 * Text that can only be on the dashboard once its data has loaded, one entry
 * per independent request.
 *
 * The widgets fetch separately and fail separately, each replacing its own
 * skeleton with its own error panel, so proving one request succeeded proves
 * nothing about the others. `Welcome, Dev` comes from the current-user
 * request; `Posts` is a seeded collection rendered by `CollectionQuickLinks`
 * from the dashboard stats, which is the request whose failure shows
 * "Connection Error" in the captured frame.
 */
const DASHBOARD_EVIDENCE = [`Welcome, ${SEEDED_FIRST_NAME}`, "Posts"];

const SCREEN_READY = {
  dashboard: async page => {
    await waitForNoSkeletons(page);
    // A skeleton count of zero is not evidence of a loaded dashboard. When a
    // request fails, widgets REPLACE their skeletons with an error state, so
    // the count reaches zero either way and a failed dashboard is captured as
    // though it were a good one. Every other screen here asserts something
    // positive; this one did not, which made it the only route where a red
    // screen could pass as evidence.
    //
    // The seeded user's NAME, not merely a greeting. `WelcomeHeader` falls
    // back to "Welcome, there" when the user request fails, so a pattern that
    // accepts any word accepts precisely the failure this check exists to
    // reject -- it matched the error state as readily as the good one.
    //
    // Coupled to `scripts/seed.ts` on purpose: the greeting can only say this
    // once that user has been fetched. If the seed's name changes, this fails
    // loudly rather than quietly widening back to "any dashboard".
    //
    // One assertion per DATA FAMILY, because the widgets fail independently.
    // The greeting covers the current-user request only; `CollectionQuickLinks`
    // has its own request and its own error state ("Connection Error"), which
    // also replaces a skeleton, so a dashboard could satisfy the greeting and
    // still be captured with an error panel in it.
    //
    // Positive content rather than a list of error strings. Enumerating the
    // failure copy means a widget that adds new copy escapes the list
    // silently, and a check that quietly stops covering something is the
    // failure mode this whole readiness map exists to avoid. A seeded
    // collection name can only render once the stats request has succeeded.
    for (const required of DASHBOARD_EVIDENCE) {
      await waitForVisibleText(page, required);
    }
  },
  collections: async page => {
    await waitForNoSkeletons(page);
    await waitForVisibleText(page, "Welcome to Nextly Playground", {
      exact: true,
    });
  },
  media: async page => {
    await waitForNoSkeletons(page);
    await waitForVisibleText(page, /sample-(1|2)\.webp/);
  },
  users: async page => {
    await waitForNoSkeletons(page);
    await waitForVisibleText(page, "dev@nextly.local", { exact: true });
  },
  settings: async page => {
    await waitForNoSkeletons(page);
    await waitForVisibleText(page, "Timezone", { exact: true });
  },
  builder: async page => {
    await waitForNoSkeletons(page);
    await waitForVisibleText(page, "posts", { exact: true });
  },
};

async function waitForNoSkeletons(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-slot="skeleton"]').length === 0,
    undefined,
    { timeout: READY_TIMEOUT }
  );
}

/**
 * Waits for a match of `textOrPattern` that is actually visible, not just
 * present anywhere in the DOM -- see the `DataTableView` note above for why
 * a plain `getByText(...).first()` isn't safe on these screens.
 */
async function waitForVisibleText(page, textOrPattern, options) {
  await page
    .getByText(textOrPattern, options)
    .and(page.locator(":visible"))
    .first()
    .waitFor({ state: "visible", timeout: READY_TIMEOUT });
}

const args = process.argv.slice(2);
const captureAllTweakcn = args.includes("--all-tweakcn");

function argValue(flag) {
  const withEquals = args.find(a => a.startsWith(`${flag}=`));
  if (withEquals) return withEquals.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const onlyIds = argValue("--only")?.split(",").map(s => s.trim());
const onlyScreens = argValue("--screens")?.split(",").map(s => s.trim());

const ALL_THEMES = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];

/**
 * Rejects a filter value that names nothing.
 *
 * A filter that silently drops what it cannot match turns a typo into a
 * quieter run: `--screens=settings,bulider` captures settings, exits zero, and
 * writes a manifest that looks complete. The missing evidence is invisible
 * precisely because the thing that would have reported it is the thing that
 * was misspelled. Selecting nothing is worse still -- an empty run that
 * reports success.
 */
function requireKnown(flag, requested, known) {
  if (!requested) return;
  const unknown = requested.filter(value => !known.includes(value));
  if (unknown.length > 0) {
    console.error(
      `capture-themes: ${flag} names ${unknown.length === 1 ? "a value that does" : "values that do"} not exist: ${unknown.join(", ")}\n` +
        `  known: ${known.join(", ")}`
    );
    process.exit(1);
  }
}

requireKnown(
  "--only",
  onlyIds,
  ALL_THEMES.map(theme => theme.id)
);
requireKnown(
  "--screens",
  onlyScreens,
  FULL_SCREENS.map(([name]) => name)
);

let themes = ALL_THEMES;
if (onlyIds) {
  const wanted = new Set(onlyIds);
  themes = themes.filter(t => wanted.has(t.id));
}

// Installing the `playwright` package does not install its browser, and the
// repository's only `playwright install` instruction is scoped to the e2e
// package. So on a fresh checkout the documented capture command died inside
// Playwright with "Executable doesn't exist", which reads as a broken script
// rather than a missing one-time setup step.
//
// Checked before launching so the message names the fix. `executablePath()`
// resolves the path Playwright WOULD use without launching anything, so this
// costs nothing when the browser is present.
const chromiumPath = chromium.executablePath();
if (!existsSync(chromiumPath)) {
  throw new Error(
    `capture-themes: Chromium is not installed. \`pnpm install\` fetches the ` +
      `playwright package but not its browsers.\n\n` +
      `  pnpm --filter playground exec playwright install chromium\n\n` +
      `Expected it at: ${chromiumPath}`
  );
}

// `pnpm install` installs the playwright PACKAGE, not its browsers, and the
// only `playwright install` instruction in this repo is scoped to the e2e
// package. So on a fresh checkout the documented capture command died with
// Playwright's own "Executable doesn't exist" message, which names a browser
// path and leaves the reader to work out that a separate provisioning step
// exists and which package to run it from.
//
// Not auto-installed: that is a ~150MB download this script would trigger
// without being asked. Naming the exact command is the useful half.
let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // ONLY the missing-executable case. Playwright prefixes every launch
  // failure with `browserType.launch`, so matching that relabelled a missing
  // host library or a sandbox denial as "Chromium is not installed" and sent
  // the reader to reinstall a browser that was already there -- replacing a
  // true error with a confident false one, which is worse than the raw
  // message this was meant to improve on.
  if (!message.includes("Executable doesn't exist")) throw error;
  throw new Error(
    `capture-themes: Chromium is not installed. \`pnpm install\` provides the ` +
      `playwright package but not its browsers.\n\n` +
      `  pnpm --filter playground exec playwright install chromium\n\n` +
      `On a bare Linux host, add the system libraries too:\n\n` +
      `  pnpm --filter playground exec playwright install --with-deps chromium\n\n` +
      `Then re-run \`pnpm --filter playground theme:capture\`.\n\n` +
      `Original error: ${message.split("\n")[0]}`
  );
}
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

// The dev harness auto-logs in, so one visit establishes the session for
// every subsequent capture -- there is no login form to drive.
await page.goto(`${BASE}/admin`);
await page.waitForLoadState("load");

// Hide the theme-lab switcher for the whole run. The admin layout mounts it
// unconditionally and it is fixed at the maximum z-index, so every
// full-viewport screenshot had it burned into the bottom-right corner --
// covering the UI these captures exist to compare, in every artifact.
//
// `addInitScript` rather than a one-off style tag: the script drives client
// navigations and reloads between themes, and a tag added to one document
// does not survive them, which would leave the switcher back in later shots
// while the early ones looked clean.
await context.addInitScript(() => {
  const hide = () => {
    const style = document.createElement("style");
    style.textContent = "[data-theme-lab-switcher]{display:none !important}";
    document.head.appendChild(style);
  };
  if (document.head) hide();
  else document.addEventListener("DOMContentLoaded", hide, { once: true });
});
await page.reload();
await page.waitForLoadState("load");

// A hidden control and an absent one look identical in a screenshot, and only
// one of them means the rule landed. Fail loudly here rather than produce a
// run of artifacts that silently kept the overlay.
const switcherHidden = await page.evaluate(() => {
  const el = document.querySelector("[data-theme-lab-switcher]");
  if (!el) return "absent";
  return getComputedStyle(el).display === "none" ? "hidden" : "visible";
});
if (switcherHidden !== "hidden") {
  throw new Error(
    `capture-themes: expected the theme-lab switcher to be hidden before ` +
      `capturing, but it is "${switcherHidden}". An "absent" result means the ` +
      `marker attribute moved and the overlay would return unnoticed.`
  );
}

let shotCount = 0;
/** Paths this run wrote, relative to the output root, for the manifest. */
const written = [];

for (const theme of themes) {
  // An explicit `--screens` outranks the abbreviated default for reference
  // themes. That default exists to keep an unattended full run short, which is
  // a reason to shorten what nobody asked for -- not a reason to drop a screen
  // somebody named. Intersecting the two instead produced an empty set for
  // `--only tweakcn-vercel --screens users`: a run that captured nothing,
  // exited zero, and listed the theme in its manifest.
  let screens =
    theme.group === "tweakcn" && !captureAllTweakcn && !onlyScreens
      ? BRIEF_SCREENS
      : FULL_SCREENS;
  if (onlyScreens) {
    const wanted = new Set(onlyScreens);
    screens = screens.filter(([name]) => wanted.has(name));
  }

  // A theme with nothing to capture is a run producing no evidence for it, and
  // the loop below would report success having taken no screenshot. The line
  // above should make this unreachable; it is asserted rather than assumed
  // because the failure it guards is silent by construction.
  if (screens.length === 0) {
    console.error(
      `capture-themes: no screens selected for "${theme.id}" -- the run would ` +
        `produce no evidence for it while reporting success.`
    );
    process.exit(1);
  }

  const dir = resolvePath(outRoot, theme.id);
  mkdirSync(dir, { recursive: true });

  for (const mode of ["light", "dark"]) {
    await page.evaluate(
      ([selection, storageKey, m]) => {
        localStorage.setItem("nextly-theme-lab", JSON.stringify(selection));
        localStorage.setItem(storageKey, m);
      },
      [
        {
          theme: theme.id,
          density: theme.recommendedDensity,
        },
        "nextly-theme",
        mode,
      ]
    );

    for (const [name, path] of screens) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState("load");
      await page.waitForSelector(".nextly-admin");

      // Confirms the write above actually took effect on this page rather
      // than assuming a load event implies it -- the failure mode being
      // guarded against is a script that "succeeds" while silently
      // capturing the previous theme or mode.
      await page.waitForFunction(
        ([themeId, isDark]) => {
          const root = document.querySelector(".nextly-admin");
          return (
            root instanceof HTMLElement &&
            root.dataset.theme === themeId &&
            root.classList.contains("dark") === isDark
          );
        },
        [theme.id, mode === "dark"]
      );

      // Proves the screen rendered real fetched data, not the loading
      // skeleton `waitForLoadState`/`waitForSelector` above can't see --
      // React Query's fetch happens after hydration, well after the page's
      // own load event fires. A screen with no ready check here would be a
      // silent gap in this guarantee, so an unrecognized name fails loudly
      // instead of screenshotting on blind trust.
      const ready = SCREEN_READY[name];
      if (!ready) {
        throw new Error(`capture-themes: no readiness check defined for screen "${name}"`);
      }
      try {
        await ready(page);
      } catch (error) {
        throw new Error(
          `capture-themes: theme "${theme.id}" (${mode}) never reached ready state on screen "${name}" within ${READY_TIMEOUT}ms -- likely still showing a loading skeleton. ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const shotPath = resolvePath(dir, `${name}-${mode}.png`);
      await page.screenshot({ path: shotPath });
      written.push(`${theme.id}/${name}-${mode}.png`);
      shotCount += 1;
    }
  }
  console.log(`captured ${theme.id}`);
}

await browser.close();

// A manifest of exactly what this run produced.
//
// A run only ever writes the files its arguments select, so anything else in
// the output directory is from an earlier one: a retired theme, a route that no
// longer exists, a screen excluded by `--screens`. Left unlabelled they sit
// beside the fresh images looking equally current, and a comparison made across
// them compares two different trees.
//
// The output is not cleared instead, because filtering by theme or screen is
// the normal way to use this: clearing would delete the captures the filter
// exists to preserve. Recording what is current says the same thing without
// destroying anything.
const stalePaths = existsSync(outRoot)
  ? readdirSync(outRoot, { recursive: true })
      .map(entry => String(entry).replaceAll("\\", "/"))
      .filter(entry => entry.endsWith(".png") && !written.includes(entry))
  : [];

writeFileSync(
  resolvePath(outRoot, "manifest.json"),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      args: process.argv.slice(2),
      themes: themes.map(theme => theme.id),
      current: written.sort(),
      note: "Files under this directory that are not in `current` were written by an earlier run with different arguments.",
      stale: stalePaths.sort(),
    },
    null,
    2
  )}\n`
);

console.log(
  `capture-themes: wrote ${shotCount} screenshots for ${themes.length} themes to ${outRoot}`
);
if (stalePaths.length > 0) {
  console.log(
    `capture-themes: ${stalePaths.length} file(s) in ${outRoot} are from an earlier run; see manifest.json`
  );
}
