/**
 * A measured page spends its horizontal inset as GRID COLUMNS rather than as
 * padding, so a negative horizontal margin on a child has nothing to pull back
 * from: it pulls the child past its own column and out of the page.
 *
 * This is measured in a browser rather than derived from the stylesheet,
 * because the distance that escapes is not a property of the declaration. Two
 * things decide it and neither is in the text:
 *
 * - `--nx-gutter` steps 2rem / 1.5rem / 1rem with the content PANEL, so one
 *   declaration escapes at one panel width and sits inside the inset at
 *   another. There is no single distance to compare a declaration against.
 * - the value may be a calc over a custom property whose operand is a runtime
 *   flag. The shipped sheet carries 97 such margins from `space-y-*` alone,
 *   all legitimate, none evaluatable from the text.
 *
 * The rendered box is where both are already resolved, so containment is asked
 * of the geometry the browser computed. That makes the check complete for any
 * spelling rather than for the spellings someone thought to enumerate.
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "../support/admin";

/**
 * Routes rendering the measured frame, reachable with no fixture beyond the
 * seeded dev user.
 *
 * `awaitLoaded` is not a convenience here. Every one of these routes renders
 * `.nx-page-shell` in its LOADING state too, so waiting for the shell says
 * nothing about whether the editor is on screen — and the editors are what
 * this frame exists for. Measured without it, the sweep read the skeletons on
 * both form routes and would have stayed green while `EntryForm` itself bled
 * out of its column.
 */
const MEASURED_ROUTES = [
  "/settings",
  "/settings/api-keys",
  "/collections/posts/create",
  "/singles/site-settings",
];

const shellOf = (page: Page) => page.locator(".nx-page-shell");

/** The announcement every one of these routes renders while it is loading. */
const loadingStatus = (page: Page) =>
  page.locator('[role="status"]').filter({ hasText: /Loading/ });

/**
 * A real interactive control inside the shell, of either kind the admin uses.
 *
 * This is the POPULATION half of readiness. The loading skeletons render only
 * `Skeleton` divs, so a control being present separates the loaded page from
 * them — and it separates both from a page that rendered nothing, which
 * satisfies "the announcement is gone" perfectly.
 */
const aControl = (page: Page) =>
  shellOf(page)
    .getByRole("textbox")
    .or(shellOf(page).getByRole("button"))
    .first();

/**
 * Both halves of "the page is ready": the loading announcement gone, and a
 * real control present. Absence alone is satisfied by a page that rendered
 * nothing at all, which is the same output as a page that finished.
 */
async function awaitLoaded(page: Page) {
  await expect(shellOf(page)).toBeVisible();
  await expect(loadingStatus(page)).toHaveCount(0);
  await expect(aControl(page)).toBeVisible();
}

/**
 * Viewport widths chosen to cross both container-query steps. The gutter keys
 * off the content PANEL rather than the viewport, so which step each width
 * lands on depends on the sidebar; the sweep asserts the set of gutters it
 * actually observed instead of assuming a mapping.
 */
const SWEEP = [1600, 1180, 740];

interface Escape {
  readonly tag: string;
  readonly cls: string;
  /** How far past the left bound, and past the right. Reported separately so a
   *  failure says which edge moved rather than only how far. */
  readonly overLeft: number;
  readonly overRight: number;
}

interface Measurement {
  readonly found: boolean;
  readonly gutter: string;
  readonly inFlow: number;
  readonly escapes: readonly Escape[];
  /** The resolved track widths, so a caller can see the grid WAS read. */
  readonly tracks: readonly number[];
}

/**
 * Every in-flow descendant's border box, compared against the bounds its own
 * placement entitles it to.
 *
 * Which bounds those are is not the same for every child, and comparing them
 * all against the shell would be too weak to catch the failure this exists
 * for: the entry editor bled 64px past the MEASURE, which on a wide panel is
 * still comfortably inside the shell's outer edges. So an ordinary child is
 * held to the content column, and a `Bleed` — which asks for `full-start` /
 * `full-end` — to the shell.
 *
 * The bounds come from the resolved `grid-template-columns`, so the gutter
 * ladder is read rather than reimplemented: whatever step is active, the
 * browser has already turned it into pixels.
 *
 * `inFlow` is returned so the caller can require that something was actually
 * examined. "No box escaped" is satisfied perfectly by a page that rendered no
 * boxes, and those are the same output.
 */
async function measure(page: Page) {
  return page.evaluate((): Measurement => {
    const empty = { gutter: "", inFlow: 0, escapes: [], tracks: [] };
    const shell = document.querySelector(".nx-page-shell");
    if (!shell) return { found: false, ...empty };

    const box = shell.getBoundingClientRect();
    const shellStyle = getComputedStyle(shell);
    const gutter = shellStyle.getPropertyValue("--nx-gutter").trim();

    // Three resolved track widths. The computed value INTERLEAVES the line
    // names with the sizes — `[full-start] 188px [content-start] 896px ...` —
    // so the lengths are matched rather than split out by position: splitting
    // on whitespace puts a name where the first track should be, and every
    // later comparison against that NaN is false. A check that reads its own
    // input wrongly reports nothing under every circumstance, and looks
    // exactly like a clean one.
    const tracks = (
      shellStyle.gridTemplateColumns.match(/[\d.]+px/g) ?? []
    ).map(parseFloat);
    if (tracks.length !== 3) return { ...empty, found: true, gutter, tracks };

    const contentLeft = box.left + tracks[0];
    const contentRight = contentLeft + tracks[1];

    // A box inside a horizontally clipping ancestor exceeds that ancestor by
    // design — a wide table in its own scroller — and the scroller is what has
    // to stay in the column. Asked of the ancestors rather than of a class
    // name, so any spelling that produces the clip is recognised.
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== shell; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") return true;
      }
      return false;
    };

    /** The rect of a box this invariant applies to, or null for one it does not. */
    const placedRect = (el: Element) => {
      const style = getComputedStyle(el);
      // Only `absolute` and `fixed` leave normal flow, and those are placed
      // against a positioned ancestor or the viewport rather than against the
      // column — so leaving it is what they are for: a dropdown, a dialog, a
      // toast. Named as the pair that ESCAPES rather than as the set that
      // stays, because the second list is the one with a hole in it: `sticky`
      // is offset from its flow position and still occupies it, so a sticky
      // child carrying a negative margin leaves the column exactly as a static
      // one does. An editor rail on a measured page is sticky.
      const outOfFlow =
        style.position === "absolute" || style.position === "fixed";
      if (outOfFlow) return null;
      const r = el.getBoundingClientRect();
      // `display: contents` and anything hidden have no box to place.
      if (r.width === 0 && r.height === 0) return null;
      return clipped(el) ? null : r;
    };

    /** The bounds this element's own placement entitles it to. */
    const boundsFor = (el: Element) => {
      let item: Element | null = el;
      while (item && item.parentElement !== shell) item = item.parentElement;
      const bleeds =
        item !== null &&
        getComputedStyle(item).gridColumnStart.includes("full");
      return bleeds
        ? { left: box.left, right: box.right }
        : { left: contentLeft, right: contentRight };
    };

    const escapes: Escape[] = [];
    let inFlow = 0;

    for (const el of shell.querySelectorAll("*")) {
      const r = placedRect(el);
      if (r === null) continue;
      inFlow++;

      const { left, right } = boundsFor(el);
      // A pixel of tolerance for subpixel layout; the failure this guards was
      // 64px.
      const overLeft = Math.round(left - r.left);
      const overRight = Math.round(r.right - right);
      if (Math.max(overLeft, overRight) > 1) {
        escapes.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString().slice(0, 120) ?? "",
          overLeft,
          overRight,
        });
      }
    }

    return { found: true, gutter, inFlow, escapes, tracks };
  });
}

test.describe("a measured page keeps its children inside the page", () => {
  for (const route of MEASURED_ROUTES) {
    test(`${route} at every step of the gutter ladder`, async ({ page }) => {
      const gutters = new Set<string>();

      for (const width of SWEEP) {
        await page.setViewportSize({ width, height: 900 });
        await gotoAdmin(page, route);
        await awaitLoaded(page);

        const m = await measure(page);

        // The population, before the verdict: a shell that never rendered and
        // a shell whose children all behaved produce the same empty escape
        // list, and only one of them is evidence.
        expect(m.found).toBe(true);
        // The grid was read, not merely queried: three resolved tracks. Without
        // this an unreadable value yields no escapes and reads as a pass.
        expect(m.tracks).toHaveLength(3);
        expect(m.inFlow).toBeGreaterThan(10);

        expect(m.escapes, `at ${width}px, gutter ${m.gutter}`).toEqual([]);
        gutters.add(m.gutter);
      }

      // The sweep is only coverage of the ladder if it actually reached each
      // step. Asserted by membership rather than by count, so a sweep that hit
      // one step three times cannot pass as three steps.
      expect([...gutters].sort()).toEqual(["1.5rem", "1rem", "2rem"]);
    });
  }

  test("the loading skeleton keeps its children inside the page", async ({
    page,
  }) => {
    // The skeleton is its own layout, not a blurred copy of the editor, and it
    // is the state that regressed: its main pane was `flex-1` with no
    // `min-w-0`, so it would not shrink and pushed the fixed-width rail 4px out
    // of the column. Measured at 1180px because that is the panel width where
    // the column is narrow enough for the rail to overflow it.
    await page.setViewportSize({ width: 1180, height: 900 });

    // Held open deliberately. On a warm dev server the skeleton lasts a few
    // frames, so a test that merely navigated would race it and read the
    // editor instead — passing while measuring the wrong state.
    await page.route("**/api/collections/schema/**", async route => {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      await route.continue();
    });

    await gotoAdmin(page, "/collections/posts/create");
    await expect(shellOf(page)).toBeVisible();
    // The skeleton IS what is on screen — asserted, not assumed, so this
    // cannot quietly become a second measurement of the loaded editor.
    await expect(loadingStatus(page)).toBeVisible();

    const m = await measure(page);
    expect(m.tracks).toHaveLength(3);
    expect(m.inFlow).toBeGreaterThan(10);
    expect(m.escapes, "at 1180px, loading").toEqual([]);
  });

  test("the measurement reports children that do escape", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await gotoAdmin(page, "/settings");
    await expect(page.locator(".nx-page-shell")).toBeVisible();

    // Real grid items on a real page, carrying the displacement that caused
    // the regression. Appended rather than borrowed from what the page already
    // rendered, so the control does not depend on which element happens to be
    // first or on how that element's own layout absorbs a margin — the point
    // is to exercise the same walk over the same geometry, from boxes whose
    // placement is known.
    //
    // One per flow position the walk claims to measure. A single static probe
    // would pass just as well against a predicate that skipped sticky, which
    // is the defect this pair exists to make visible.
    const placed = await page.evaluate(() => {
      const shell = document.querySelector(".nx-page-shell");
      if (!shell) return 0;
      const probes = [
        { cls: "nx-e2e-escapee-static", position: "" },
        { cls: "nx-e2e-escapee-sticky", position: "sticky" },
      ];
      for (const { cls, position } of probes) {
        const probe = document.createElement("div");
        probe.className = cls;
        probe.style.marginInline = "-8rem";
        probe.style.height = "20px";
        if (position) probe.style.position = position;
        shell.appendChild(probe);
      }
      return probes.length;
    });
    expect(placed).toBe(2);

    const m = await measure(page);
    expect(m.found).toBe(true);
    expect(m.tracks).toHaveLength(3);
    // Named, not counted: an unrelated escape already on the page would
    // satisfy a non-empty list while an injected one stayed invisible.
    const named = m.escapes.map(e => e.cls).join(" ");
    expect(named).toContain("nx-e2e-escapee-static");
    expect(named).toContain("nx-e2e-escapee-sticky");
  });
});
