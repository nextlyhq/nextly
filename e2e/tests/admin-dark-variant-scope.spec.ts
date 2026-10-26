/**
 * The admin's variant confinement, in a browser.
 *
 * The admin's `dark:`/`group-*:`/`peer-*:` utilities compile to a reference to
 * an ancestor class the rule does not own. Before confinement, a host app's
 * own `<html class="dark">` (next-themes with `attribute="class"`, Tailwind's
 * class strategy) satisfied every dark utility inside the admin while the
 * admin's tokens stayed light — dark borders and text painted onto light
 * surfaces. The published sheet now rewrites those references to sit under
 * `.nextly-admin`, and the admin's own dark mode keeps working from the admin
 * root, as its theme sync applies it there.
 *
 * What is checked here, against the sheet the playground actually loads:
 *
 * - R-1: the host's dark class on the document root leaves the light admin's
 *   computed colours untouched, added or removed while the admin is open.
 * - R-2: the admin's own dark theme paints its dark utilities and tokens
 *   together, and renders unmixed with the host class present.
 * - R-4: a `group-hover` variant driven by its marker inside the admin (the
 *   dashboard header's GitHub link, whose icon brightens while the pointer is
 *   on the link) keeps applying, in both of the admin's own themes.
 *
 * The screens are the Releases list with one published release of our own:
 * its state badge and status icon are resting elements whose classes carry
 * `dark:` variants, which the admin's lighter screens (the dashboard among
 * them) render none of — a colour sweep there would pass vacuously, whatever
 * the sheet did.
 *
 * @module tests/admin-dark-variant-scope
 */
import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { contrastRatio, gotoAdmin, toRgb, type Theme } from "./support/admin";
import { post, publishNow, release } from "./support/releases-api";

/**
 * A sweep of the computed colours the admin's sheet paints.
 *
 * Every element carrying a `dark:` utility (the utilities the host's class
 * used to flip) plus the screen surfaces, in both `.nextly-admin` roots — the
 * app root and the portal root — so a host class that reached any of them
 * shows up as a diff rather than going unseen between chosen elements. The
 * dark-utility subject count comes with it, because a sweep over zero such
 * elements proves nothing and must fail the test that relies on it.
 */
async function colourSnapshot(page: Page): Promise<{
  colours: Record<string, string>;
  darkUtilitySubjects: number;
}> {
  return page.evaluate(() => {
    const colours: Record<string, string> = {};
    const roots = document.querySelectorAll(".nextly-admin");
    if (roots.length === 0) throw new Error("no .nextly-admin root");

    const subjects: Element[] = [];
    for (const root of roots) {
      for (const el of [
        root.querySelector("main"),
        root.querySelector("header"),
        ...root.querySelectorAll('[class*="dark:"]'),
      ]) {
        if (el) subjects.push(el);
      }
    }
    const darkUtilitySubjects = subjects.length;

    subjects.slice(0, 150).forEach((el, i) => {
      const cs = getComputedStyle(el);
      const classes = (el.getAttribute("class") ?? "").slice(0, 60);
      colours[`${i}:${el.tagName}:${classes}`] =
        `${cs.color} | ${cs.backgroundColor} | ${cs.borderTopColor}`;
    });
    return { colours, darkUtilitySubjects };
  });
}

/**
 * One published release, so the Releases list holds the resting elements this
 * spec reads: a state badge and a status icon in the published tone, whose
 * classes carry `dark:` variants. Returns the release's title, to find it by.
 */
async function onePublishedRelease(page: Page): Promise<string> {
  const stamp = `${Date.now()}`;
  const postId = await post(page, stamp);
  const id = await release(page, `Variant scope ${stamp}`, postId);
  await publishNow(page, id);
  return `Variant scope ${stamp}`;
}

/**
 * Open the Done tab, where a published release's badge and icon land.
 *
 * The tab's own name carries its count (`Done (2)`), so a count of zero —
 * the release this spec published never landed — fails here rather than
 * letting the colour reads below run over an empty list. The badge is the
 * element they read, so it is what is waited for; the release's title itself
 * renders twice in a row (its table row and its phone-width card), one of
 * them hidden, which makes it a poor thing to wait on.
 */
async function openDoneTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /Done \(\d+\)/ }).click();
  // `:visible` because each row renders twice — a table row at a desk's
  // width and a card at a phone's — and one of the two is always hidden.
  await expect(
    page.locator('[role="tabpanel"] [data-slot^="badge."]:visible').first()
  ).toBeVisible();
}

/** The first state badge's ink and paper, as computed strings. */
function stateBadgeColours(page: Page) {
  return page
    .locator('[role="tabpanel"] [data-slot^="badge."]:visible')
    .first()
    .evaluate(el => {
      const cs = getComputedStyle(el);
      return `${cs.color} | ${cs.backgroundColor}`;
    });
}

test.describe("the admin's variant confinement", () => {
  test("a host's dark class leaves the light admin untouched (R-1)", async ({
    page,
  }) => {
    await onePublishedRelease(page);
    await gotoAdmin(page, "/releases");
    await openDoneTab(page);

    const without = await colourSnapshot(page);
    // The sweep has to have dark-variant elements to read, or both equality
    // checks below pass vacuously — the light dashboard renders none, which
    // is why this spec drives the Releases list.
    expect(without.darkUtilitySubjects).toBeGreaterThan(2);

    // The host applies its dark class to the document root at run time.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const withHostDark = await colourSnapshot(page);
    expect(withHostDark.colours).toEqual(without.colours);

    // And takes it off again: neither direction leaves anything behind.
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark")
    );
    const after = await colourSnapshot(page);
    expect(after.colours).toEqual(without.colours);
  });

  test("the admin's own dark theme is unmixed under the host class (R-2)", async ({
    page,
  }) => {
    await onePublishedRelease(page);
    await gotoAdmin(page, "/releases");
    await openDoneTab(page);

    // The badge's colours in the admin's LIGHT theme, for the flip to be
    // measured against rather than assumed.
    const lightBadge = await stateBadgeColours(page);

    // Re-open the same screen in the admin's DARK theme. gotoAdmin pins the
    // theme again rather than the page being reloaded with new storage: its
    // init script is registered a second time, and init scripts run in the
    // order they were registered, so the later "dark" write is the one that
    // stands when the app reads `nextly-theme` before its first paint.
    await gotoAdmin(page, "/releases", "dark");
    await openDoneTab(page);

    // The admin's own dark mode paints its dark utilities and tokens
    // TOGETHER: the badge moves to its dark palette, and the screen's ink is
    // light on dark paper. A confinement that broke the admin's own dark
    // mode would leave the badge on its light colours and fail here.
    const darkBadge = await stateBadgeColours(page);
    expect(darkBadge).not.toEqual(lightBadge);
    const screen = page.locator(".nextly-admin .bg-background").first();
    const ink = await screen
      .evaluate(el => getComputedStyle(el).color)
      .then(css => toRgb(page, css));
    const paper = await screen
      .evaluate(el => getComputedStyle(el).backgroundColor)
      .then(css => toRgb(page, css));
    expect(
      contrastRatio(ink, [0, 0, 0]),
      "dark theme text is light"
    ).toBeGreaterThan(10);
    expect(
      contrastRatio(paper, [255, 255, 255]),
      "dark theme paper is dark"
    ).toBeGreaterThan(10);

    // With the host's class present too, the dark theme renders unmixed:
    // every swept colour holds, and the badge stays on its dark palette.
    const without = await colourSnapshot(page);
    expect(without.darkUtilitySubjects).toBeGreaterThan(2);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const withHostDark = await colourSnapshot(page);
    expect(withHostDark.colours).toEqual(without.colours);
    expect(await stateBadgeColours(page)).toEqual(darkBadge);
  });

  for (const theme of ["light", "dark"] as Theme[]) {
    test(`a group-hover variant driven inside the admin keeps applying (${theme}) (R-4)`, async ({
      page,
    }) => {
      await gotoAdmin(page, "/", theme);

      // The dashboard header's GitHub link is the `.group`; its icon carries
      // `group-hover:text-foreground` and rests at `text-muted-foreground`, so
      // the icon's ink is exactly what the confined
      // `:is(:where(.nextly-admin .group):hover *)` variant drives — plain
      // hover on the icon itself styles nothing (the hover classes are the
      // link's).
      const link = page.locator('header a[title="GitHub Repository"]');
      const icon = link.locator("svg").first();
      await expect(icon).toBeVisible();

      const resting = await icon.evaluate(el => getComputedStyle(el).color);

      await link.hover();
      // `transition-colors` eases the change in; poll for its landing.
      await expect
        .poll(() => icon.evaluate(el => getComputedStyle(el).color))
        .not.toBe(resting);
    });
  }
});
