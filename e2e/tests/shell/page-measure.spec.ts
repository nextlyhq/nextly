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
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "../support/admin";

/**
 * Routes rendering the measured frame, one per width it offers. Both are
 * reachable with no fixture beyond the seeded dev user.
 */
const MEASURED_ROUTES = ["/settings", "/settings/api-keys"];

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
  readonly over: number;
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
async function measure(page: import("@playwright/test").Page) {
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
      // Out-of-flow boxes are placed against the viewport or a positioned
      // ancestor rather than against the column, so leaving it is what they
      // are for: a dropdown, a dialog, a toast.
      const inFlow =
        style.position === "static" || style.position === "relative";
      if (!inFlow) return null;
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
      const over = Math.max(left - r.left, r.right - right);
      if (over > 1) {
        escapes.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString().slice(0, 120) ?? "",
          over: Math.round(over),
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
        await expect(page.locator(".nx-page-shell")).toBeVisible();

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

  test("the measurement reports a child that does escape", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await gotoAdmin(page, "/settings");
    await expect(page.locator(".nx-page-shell")).toBeVisible();

    // A real grid item on a real page, carrying the displacement that caused
    // the regression. Appended rather than borrowed from what the page already
    // rendered, so the control does not depend on which element happens to be
    // first or on how that element's own layout absorbs a margin — the point
    // is to exercise the same walk over the same geometry, from a box whose
    // placement is known.
    const placed = await page.evaluate(() => {
      const shell = document.querySelector(".nx-page-shell");
      if (!shell) return false;
      const probe = document.createElement("div");
      probe.className = "nx-e2e-escapee";
      probe.style.marginInline = "-8rem";
      probe.style.height = "20px";
      shell.appendChild(probe);
      return true;
    });
    expect(placed).toBe(true);

    const m = await measure(page);
    expect(m.found).toBe(true);
    expect(m.tracks).toHaveLength(3);
    // Named, not counted: an unrelated escape already on the page would
    // satisfy a non-empty list while the injected one stayed invisible.
    expect(m.escapes.map(e => e.cls).join(" ")).toContain("nx-e2e-escapee");
  });
});
