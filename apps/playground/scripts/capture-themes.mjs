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
 *   node scripts/capture-themes.mjs [--all-tweakcn] [--only id1,id2] [--screens name1,name2]
 *
 * `--only` and `--screens` restrict the run to specific theme ids / screen
 * names (both match against the values below) and exist for smoke-testing a
 * small slice before committing to the full pass, which takes a while.
 */
import { mkdirSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

// Registered before the theme-lab modules are imported below, so their own
// extensionless internal imports resolve. See ts-extension-loader.mjs; the
// same hook is used by generate-contrast-report.mjs for the same reason.
register("./ts-extension-loader.mjs", import.meta.url);

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
const SCREEN_READY = {
  dashboard: async page => {
    await waitForNoSkeletons(page);
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

let themes = [...NEXTLY_THEMES, ...TWEAKCN_THEMES];
if (onlyIds) {
  const wanted = new Set(onlyIds);
  themes = themes.filter(t => wanted.has(t.id));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

// The dev harness auto-logs in, so one visit establishes the session for
// every subsequent capture -- there is no login form to drive.
await page.goto(`${BASE}/admin`);
await page.waitForLoadState("load");

let shotCount = 0;

for (const theme of themes) {
  let screens =
    theme.group === "tweakcn" && !captureAllTweakcn
      ? BRIEF_SCREENS
      : FULL_SCREENS;
  if (onlyScreens) {
    const wanted = new Set(onlyScreens);
    screens = screens.filter(([name]) => wanted.has(name));
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
      shotCount += 1;
    }
  }
  console.log(`captured ${theme.id}`);
}

await browser.close();

console.log(
  `capture-themes: wrote ${shotCount} screenshots for ${themes.length} themes to ${outRoot}`
);
