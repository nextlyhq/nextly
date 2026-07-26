/**
 * Screenshots every theme lab theme across the admin's main screens in both
 * modes.
 *
 * Themes are applied by writing the same localStorage keys the switcher and
 * ThemeProvider use and then navigating, rather than by clicking the panel,
 * so a change to the panel's markup cannot silently break a capture run:
 *
 *   - `nextly-theme-lab` holds the full `{ theme, layout, density }` selection
 *     `useThemeLab` persists (src/theme-lab/use-theme-lab.ts). Writing only
 *     `{ theme }` would drop layout/density back to whatever the last write
 *     left them at instead of the theme's own recommendation.
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

const { NEXTLY_THEMES } = await import("../src/theme-lab/themes/index.ts");
const { TWEAKCN_THEMES } = await import(
  "../src/theme-lab/themes/tweakcn.generated.ts"
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
          layout: theme.recommendedLayout,
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
