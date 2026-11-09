/**
 * The canvas in a frame of its own, in a real browser.
 *
 * The page builder draws the page in an iframe the editor owns, at the chosen
 * device's width and the height its width implies, and draws its chrome over
 * it in the admin's document. What that buys, and what it must not cost, is
 * only observable here: media queries, `vw`, `vh` and container queries
 * answering for the device; the admin's theme kept out of the page; focus and
 * keys crossing the frame's edge; and chrome staying on the block it marks at
 * any zoom and scroll.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * blocks field, and compared against the same document as the site serves it.
 *
 * @module tests/canvas/frame-acceptance
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin, toRgb, type Theme } from "../support/admin";
import { expectNoAxeViolations } from "../support/axe";
import {
  CANVAS_FRAME,
  canvasBlock,
  canvasFrame,
  canvasLayer,
  frameAndRoom,
} from "../support/canvas-frame";
import { LOCK } from "../support/locks";
import {
  storeSiteBreakpoints,
  type SiteBreakpoints,
} from "../support/site-breakpoints";
import { ownSeat, test } from "../support/test";

import { openEditorWith, selection, structure } from "./editor-driver";

// The homepage document and the site's breakpoints are both written here.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

// The editor reads `mod` as Control in the Desktop Chrome device this suite
// runs as, whatever the host; see `editor-acceptance.spec.ts`.
const UNDO = "Control+z";
const SAVE = "Control+s";

/** A text block, with styles by interaction state and then breakpoint. */
function text(
  id: string,
  words: string,
  styles?: Record<string, Record<string, Record<string, unknown>>>
) {
  return {
    id,
    type: "core/text",
    version: 1,
    props: { text: words },
    ...(styles === undefined ? {} : { styles }),
  };
}

const RED = "#ff0000";
const BLUE = "#0000ff";
const GREEN = "#008000";

/**
 * Blocks whose computed values depend on the viewport, each in one way: a
 * length in `vw` and `vh`, a colour set per viewport breakpoint (an `@media`
 * rule), and a colour set per container breakpoint inside a 300px query
 * container (an `@container` rule).
 */
const FIDELITY = [
  text("sized", "Sized by the viewport", {
    base: { base: { width: "25vw", height: "50vh" } },
  }),
  text("tiered", "Coloured by the viewport", {
    base: {
      base: { color: RED },
      tablet: { color: BLUE },
      mobile: { color: GREEN },
    },
  }),
  {
    id: "query-host",
    type: "core/section",
    version: 1,
    props: { as: "section" },
    styles: {
      base: { base: { containerType: "inline-size", width: "300px" } },
    },
    slots: {
      children: [
        text("queried", "Coloured by its container", {
          base: { base: { color: RED }, narrow: { color: BLUE } },
        }),
      ],
    },
  },
];

/** The breakpoints the fidelity cases are styled against. */
const BREAKPOINTS = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [{ id: "narrow", label: "Narrow", maxWidth: 400 }],
};

/** The devices those breakpoints give, at the size the frame lays each out. */
const DEVICES = [
  { name: /^Desktop/, width: 1280, height: 800 },
  { name: /^Tablet/, width: 1024, height: 800 },
  { name: /^Mobile/, width: 640, height: 1024 },
] as const;

async function storeBreakpoints(
  page: Page,
  value: SiteBreakpoints
): Promise<void> {
  await storeSiteBreakpoints(page.request, value);
}

/** What a block's rendering says about the viewport it was laid out in. */
interface Reading {
  readonly width: number;
  readonly height: number;
  readonly tiered: string;
  readonly queried: string;
}

/**
 * Read the fidelity blocks inside `scope`, found by their words, so the same
 * reading works on the canvas and on the published page, which carries no
 * editor addressing.
 */
async function readFidelity(scope: {
  getByText: Page["getByText"];
}): Promise<Reading> {
  const sized = scope.getByText("Sized by the viewport", { exact: true });
  const box = await sized.evaluate(element => {
    const el = element as HTMLElement;
    return { width: el.offsetWidth, height: el.offsetHeight };
  });
  const colourOf = (words: string) =>
    scope
      .getByText(words, { exact: true })
      .evaluate(
        element =>
          element.ownerDocument.defaultView?.getComputedStyle(element).color ??
          ""
      );
  return {
    ...box,
    tiered: await colourOf("Coloured by the viewport"),
    queried: await colourOf("Coloured by its container"),
  };
}

function devices(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "Device" });
}

async function chooseDevice(page: Page, name: RegExp): Promise<void> {
  const button = devices(page).getByRole("radio", { name });
  await button.click();
  await expect(button).toBeChecked();
}

function zoomTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /^Canvas zoom:/ });
}

async function chooseZoom(page: Page, label: string): Promise<void> {
  await zoomTrigger(page).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

/** The frame's layout size, which the zoom never changes. */
async function frameSize(
  page: Page
): Promise<{ width: number; height: number }> {
  return page.locator(CANVAS_FRAME).evaluate(element => {
    const el = element as HTMLElement;
    return { width: el.offsetWidth, height: el.offsetHeight };
  });
}

/** The published page in a window the size of `size`. */
async function published(
  page: Page,
  size: { width: number; height: number }
): Promise<Reading> {
  const site = await page.context().newPage();
  try {
    await site.setViewportSize(size);
    await site.goto("/");
    await expect(
      site.getByText("Sized by the viewport", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    return await readFidelity(site);
  } finally {
    await site.close();
  }
}

test.describe("the page on the canvas behaves as on a device of that size", () => {
  test.describe.configure({ timeout: 300_000 });

  test("vw, vh, media and container queries match the published page at each device", async ({
    page,
  }) => {
    await storeBreakpoints(page, BREAKPOINTS);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openEditorWith(page, FIDELITY, "sized");
      for (const device of DEVICES) {
        await chooseDevice(page, device.name);
        // The device's width; the height is the canvas window's, which fills
        // the room the editor gives it, so the published page is read in a
        // window of that same size.
        await expect
          .poll(async () => (await frameSize(page)).width)
          .toBe(device.width);
        const window = await frameSize(page);
        const canvas = await readFidelity(canvasFrame(page));
        const site = await published(page, window);
        expect(
          canvas,
          `${String(device.name)} matches the published page`
        ).toEqual(site);
      }
      // The control: the cases above are not all reading one value. The
      // breakpoints really do change the colour between Desktop and Mobile.
      await chooseDevice(page, /^Desktop/);
      const desktop = await readFidelity(canvasFrame(page));
      await chooseDevice(page, /^Mobile/);
      const mobile = await readFidelity(canvasFrame(page));
      expect(desktop.tiered).not.toBe(mobile.tiered);
    } finally {
      await storeBreakpoints(page, null);
    }
  });

  test("vh is the canvas window's height, whatever the panels or the zoom", async ({
    page,
  }) => {
    await storeBreakpoints(page, BREAKPOINTS);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openEditorWith(page, FIDELITY, "sized");
      const sized = canvasBlock(page, "sized");
      // The block is 50vh: half of the window the page is laid out in,
      // which is the canvas frame's own height, as it is a browser window's
      // for a visitor.
      // And the window is the room: painted, the frame is as tall as the
      // region it is laid into, so the window changes with the room and the
      // zoom rather than standing at one device height.
      const halfTheWindow = async (): Promise<boolean> => {
        const block = await sized.evaluate(
          element => (element as HTMLElement).offsetHeight
        );
        const window = await frameSize(page);
        const { painted, room } = await frameAndRoom(page);
        return (
          Math.abs(block - window.height / 2) <= 1 &&
          Math.abs(painted - room) <= 1
        );
      };
      await expect.poll(halfTheWindow).toBe(true);

      // Both sides hidden, then shown again, and at two zooms: the window
      // changes with the room, and vh with it.
      await canvasBlock(page, "sized").click();
      await page.keyboard.press("Control+\\");
      await expect.poll(halfTheWindow).toBe(true);
      await page.keyboard.press("Control+\\");
      await expect.poll(halfTheWindow).toBe(true);

      const windows: number[] = [];
      for (const zoom of ["50%", "200%"]) {
        await chooseZoom(page, zoom);
        await expect(zoomTrigger(page)).toHaveText(zoom);
        await expect.poll(halfTheWindow).toBe(true);
        windows.push((await frameSize(page)).height);
      }
      // Four times as tall at half the zoom as at twice it: the window really
      // follows the zoom, which a fixed device height would not.
      expect(Math.round((windows[0] ?? 0) / (windows[1] ?? 1))).toBe(4);
    } finally {
      await storeBreakpoints(page, null);
    }
  });

  test("a bare page starts at the frame's edge, as the published page does", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, [text("bare", "A bare page")], "bare");
    const inFrame = await canvasFrame(page)
      .locator(".nx-canvas")
      .evaluate(element => {
        const box = element.getBoundingClientRect();
        const body = getComputedStyle(element.ownerDocument.body);
        return { x: box.x, y: box.y, margin: body.margin };
      });
    // No user-agent margin around the page.
    expect(inFrame).toEqual({ x: 0, y: 0, margin: "0px" });
    const canvasText = await canvasBlock(page, "bare").evaluate(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, width: box.width };
    });
    const site = await page.context().newPage();
    try {
      await site.setViewportSize({ width: 1280, height: 800 });
      await site.goto("/");
      const siteText = site.getByText("A bare page", { exact: true });
      await expect(siteText).toBeVisible({ timeout: 30_000 });
      const box = await siteText.evaluate(element => {
        const b = element.getBoundingClientRect();
        return { x: b.x, width: b.width };
      });
      expect(canvasText).toEqual(box);
    } finally {
      await site.close();
    }
  });
});

/** A text block across the whole page, with padding inside that width. */
const PADDED = text("padded", "A padded block", {
  base: {
    base: {
      width: "100%",
      padding: { inlineStart: "40px", inlineEnd: "40px" },
    },
  },
});

/** The padded block's border-box width beside the width of what holds it. */
async function paddedWidths(
  page: Page
): Promise<{ block: number; container: number }> {
  return canvasBlock(page, "padded").evaluate(element => ({
    block: element.getBoundingClientRect().width,
    container: element.parentElement?.getBoundingClientRect().width ?? 0,
  }));
}

test.describe("boxes on the canvas size as most site resets size them", () => {
  test("a padded block at full width is exactly as wide as what holds it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, [PADDED], "padded");
    const widths = await paddedWidths(page);
    // Border-box: the padding is inside the 100%, not added to it.
    expect(widths.container).toBeGreaterThan(0);
    expect(widths.block).toBe(widths.container);
  });

  test("a site rule for box-sizing in the frame wins over the frame's default", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, [PADDED], "padded");
    // The control: the frame's default alone.
    const alone = await paddedWidths(page);
    expect(alone.block).toBe(alone.container);

    // A site sheet loaded into the frame's head after the frame's own page:
    // plain rules, then rules in a layer of the site's own, as a site's reset
    // ships them. Each wins, and the padding is added to the width again.
    for (const rule of [
      "*, ::before, ::after { box-sizing: content-box; }",
      "@layer base { *, ::before, ::after { box-sizing: content-box; } }",
    ]) {
      await canvasFrame(page)
        .locator("head")
        .evaluate((head, css) => {
          const style = head.ownerDocument.createElement("style");
          style.dataset.e2eSiteSheet = "";
          style.textContent = css;
          head.append(style);
        }, rule);
      const widths = await paddedWidths(page);
      expect(widths.block, rule).toBe(widths.container + 80);
      await canvasFrame(page)
        .locator("style[data-e2e-site-sheet]")
        .evaluate(style => style.remove());
    }
  });
});

/** The colour a reader sees behind an element, walking up to a painted one. */
async function groundBehind(target: Locator): Promise<string> {
  return target.evaluate(element => {
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const fill = getComputedStyle(at).backgroundColor;
      if (fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") return fill;
    }
    return "rgb(255, 255, 255)";
  });
}

test.describe("the canvas keeps the site's colours whatever the admin's theme", () => {
  test.describe.configure({ timeout: 300_000 });

  for (const theme of ["dark", "light"] as const satisfies readonly Theme[]) {
    test(`with the admin in ${theme} mode, at each device width`, async ({
      page,
    }) => {
      await storeBreakpoints(page, BREAKPOINTS);
      try {
        const nodes = [text("lead", "The site's own colours")];
        const stored = await page.request.patch("/admin/api/singles/homepage", {
          data: {
            layout: { formatVersion: 1, kind: "page", nodes },
            _overwrite: true,
          },
        });
        expect(stored.ok()).toBe(true);
        await page.setViewportSize({ width: 1440, height: 900 });
        await gotoAdmin(page, "/singles/homepage", theme);
        await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
        const lead = canvasBlock(page, "lead");
        await expect(lead).toBeVisible({ timeout: 30_000 });
        // The admin really is in the theme asked for: its own text colour.
        const adminScheme = await page
          .locator(".nx-builder-chrome")
          .first()
          .evaluate(element => getComputedStyle(element).colorScheme);
        expect(adminScheme).toContain(theme);

        for (const device of DEVICES) {
          await chooseDevice(page, device.name);
          const ground = await toRgb(
            page,
            await groundBehind(canvasFrame(page).locator(".nx-canvas"))
          );
          const ink = await toRgb(
            page,
            await lead.evaluate(element => getComputedStyle(element).color)
          );
          const scheme = await canvasFrame(page)
            .locator(".nx-canvas")
            .evaluate(element => getComputedStyle(element).colorScheme);

          const site = await page.context().newPage();
          let siteScheme = "";
          try {
            await site.setViewportSize(device);
            await site.goto("/");
            const siteLead = site.getByText("The site's own colours", {
              exact: true,
            });
            await expect(siteLead).toBeVisible({ timeout: 30_000 });
            const siteGround = await toRgb(
              site,
              await groundBehind(site.locator(".nx-pb-page").first())
            );
            expect(ground, `${theme} admin, ${String(device.name)}`).toEqual(
              siteGround
            );
            siteScheme = await site
              .locator(".nx-pb-page")
              .first()
              .evaluate(element => getComputedStyle(element).colorScheme);
          } finally {
            await site.close();
          }
          // The page is in the site's own scheme, whatever the admin's, and
          // its text reads on it. The site's stylesheet decides the scheme, as
          // it does for the published page, rather than the editor.
          expect(scheme).toBe(siteScheme);
          expect(ink).not.toEqual(ground);
        }
      } finally {
        await storeBreakpoints(page, null);
      }
    });
  }
});

/** Whether the canvas frame holds focus, read from the admin's document. */
async function frameFocused(page: Page): Promise<boolean> {
  return page.evaluate(
    selector => document.activeElement === document.querySelector(selector),
    CANVAS_FRAME
  );
}

test.describe("focus and keys across the frame's edge", () => {
  test.describe.configure({ timeout: 180_000 });

  const NODES = [
    text("first", "The first block"),
    text("second", "The second block"),
    text("third", "The third block"),
  ];

  test("the frame is named for the page, and F6 and Tab move in and out of it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "first");
    const frame = page.locator(CANVAS_FRAME);
    await expect(frame).toHaveAttribute("title", /^Page canvas: .+/);

    // F6 reaches the canvas, and lands inside the frame rather than on the
    // region around it.
    let reached = false;
    for (let press = 0; press < 6 && !reached; press += 1) {
      await page.keyboard.press("F6");
      reached = await frameFocused(page);
    }
    expect(reached, "F6 moves focus into the frame").toBe(true);
    // And on, out of it.
    await page.keyboard.press("F6");
    expect(await frameFocused(page)).toBe(false);

    // Shift+Tab out of the frame does not land on a stop that sends it back.
    await frame.focus();
    expect(await frameFocused(page)).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(await frameFocused(page)).toBe(false);
    await page.keyboard.press("Tab");
    expect(await frameFocused(page)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await frameFocused(page)).toBe(false);
  });

  test("Escape, Mod+S and Mod+Z work with focus in the frame, and Escape never leaves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "first");
    const address = page.url();

    // A click on a block puts focus in the frame's document.
    await canvasBlock(page, "second").click();
    expect(await frameFocused(page)).toBe(true);
    await expect.poll(() => selection(page)).toEqual(["second"]);

    // A keyboard move, then undo, pressed in the frame.
    await page.keyboard.press("Alt+ArrowUp");
    await expect
      .poll(() => structure(page))
      .toEqual(["second", "first", "third"]);
    await page.keyboard.press(UNDO);
    await expect
      .poll(() => structure(page))
      .toEqual(["first", "second", "third"]);

    // Escape clears the selection, and a second one, with nothing selected,
    // does not take the editor away: the admin's "cancel and go back" never
    // hears a key pressed in the frame.
    await page.keyboard.press("Escape");
    await expect.poll(() => selection(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(address);
    await expect(canvasBlock(page, "first")).toBeVisible();

    // Mod+S saves, pressed in the frame.
    await canvasBlock(page, "third").click();
    await page.keyboard.press("Alt+ArrowUp");
    const saved = page.waitForResponse(
      response =>
        response.request().method() === "PATCH" &&
        response.url().includes("/admin/api/singles/homepage")
    );
    await page.keyboard.press(SAVE);
    expect((await saved).ok()).toBe(true);
  });

  test("Delete and Backspace while typing in the frame change no block", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "first");
    const target = canvasBlock(page, "second");
    await target.click();
    // Enter opens the selected block's text, inside the frame.
    await page.keyboard.press("Enter");
    await expect(target).toHaveAttribute("contenteditable", /.+/);
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Delete");
    await expect
      .poll(() => structure(page))
      .toEqual(["first", "second", "third"]);
    await expect(target).toHaveText("The second bloc");

    // The control: with the block selected and nothing being typed, Delete
    // does remove it.
    await page.keyboard.press("Escape");
    await canvasBlock(page, "third").click();
    await page.keyboard.press("Delete");
    await expect.poll(() => structure(page)).toEqual(["first", "second"]);
  });

  test("the canvas region and the frame pass an accessibility scan", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "first");
    await expectNoAxeViolations(page, {
      include: 'section[aria-label="Canvas"]',
    });
  });
});

/** A box in the admin's coordinates. */
type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("[e2e] nothing drawn to measure");
  return found;
}

/**
 * How far outside a block its selection ring is drawn, in screen pixels at any
 * zoom: the ring and its halo, at the page's edge too, where the canvas's
 * chrome draws past the frame for it.
 */
const RING_OUTSIDE = 4;

/** How far each edge of the ring sits outside the block's. */
function ringGaps(mark: Box, block: Box): Record<string, number> {
  return {
    left: block.x - mark.x,
    top: block.y - mark.y,
    right: mark.x + mark.width - (block.x + block.width),
    bottom: mark.y + mark.height - (block.y + block.height),
  };
}

/**
 * Around the block on every edge, by the ring's distance: a ring drawn on the
 * block's own edge, or held back at the page's, would leave a gap of none.
 */
function expectRinged(mark: Box, block: Box, what: string): void {
  for (const [edge, gap] of Object.entries(ringGaps(mark, block))) {
    expect(gap, `${what}: ${edge}`).toBeGreaterThanOrEqual(RING_OUTSIDE - 1);
    expect(gap, `${what}: ${edge}`).toBeLessThanOrEqual(RING_OUTSIDE + 1);
  }
}

test.describe("the frame in the canvas region", () => {
  /** How far the frame's top edge sits under the canvas region's. */
  async function topGap(page: Page): Promise<number> {
    const region = await page
      .getByRole("region", { name: "Canvas" })
      .boundingBox();
    const box = await page.locator("[data-nx-canvas-frame-box]").boundingBox();
    if (region === null || box === null) throw new Error("no layout");
    return box.y - region.y;
  }

  test("sits just under the top bar at Fit and at 50%, rather than centred", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, [text("gap", "A short page")], "gap");
    // At Fit the painted page is shorter than the region, and still starts
    // at the region's own gutter rather than half way down.
    expect(Math.abs((await topGap(page)) - 16)).toBeLessThanOrEqual(1);
    await chooseZoom(page, "50%");
    await expect.poll(() => topGap(page)).toBeGreaterThan(0);
    expect(Math.abs((await topGap(page)) - 16)).toBeLessThanOrEqual(1);
  });

  test("scrolls from the keyboard when the zoom paints the frame past the region", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(
      page,
      [text("wide", "A page zoomed past its region")],
      "wide"
    );
    await chooseZoom(page, "200%");
    // The zoom menu hands focus back to its trigger as it closes; taken
    // first, so focus moved after it is not taken back.
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(zoomTrigger(page)).toBeFocused();
    const region = page.getByRole("region", { name: "Canvas" });
    // The region itself scrolls the painted frame; it is a tab stop of its
    // own while it does, and keeps focus rather than handing it on.
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await expect(region).toBeFocused();
    const before = await region.evaluate(element => element.scrollLeft);
    for (let press = 0; press < 5; press += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await expect
      .poll(() => region.evaluate(element => element.scrollLeft))
      .toBeGreaterThan(before);
  });
});

test.describe("a locked block's ring", () => {
  test("is dashed over the frame", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(
      page,
      [{ ...text("held", "A locked block"), locked: true }],
      "held"
    );
    try {
      // A locked block still selects, so it can be unlocked.
      await canvasBlock(page, "held").click();
      const ring = canvasLayer(page).locator(
        '.nx-canvas-mark[data-mark="selected"]'
      );
      await expect(ring).toHaveCSS("outline-style", "dashed");
    } finally {
      // Unlocked again, as the server lets a lock be lifted: a locked block
      // left on the shared homepage refuses every later test's layout.
      const unlocked = await page.request.patch("/admin/api/singles/homepage", {
        data: {
          layout: {
            formatVersion: 1,
            kind: "page",
            nodes: [text("held", "A locked block")],
          },
          _overwrite: true,
        },
      });
      expect(unlocked.ok(), `unlocking: ${unlocked.status()}`).toBe(true);
    }
  });
});

test.describe("chrome drawn over the frame stays on the block", () => {
  test.describe.configure({ timeout: 240_000 });

  // Tall enough that the frame's own viewport scrolls.
  const NODES = Array.from({ length: 14 }, (_, index) =>
    text(`block-${String(index)}`, `Block number ${String(index)}`, {
      base: {
        base: {
          padding: {
            blockStart: "40px",
            blockEnd: "40px",
            inlineStart: "24px",
            inlineEnd: "24px",
          },
        },
      },
    })
  );

  test("the toolbar takes the pointer on its buttons only, and fades over another block", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "block-0");
    await canvasBlock(page, "block-2").click();
    const toolbar = canvasLayer(page).locator(".nx-block-toolbar");
    const buttons = toolbar.locator("button");
    await expect(buttons.nth(1)).toBeVisible();

    // Between the first two buttons, and on one: what the page answers for a
    // pointer there. The gap is the bar's, so it reaches what is under it.
    const first = await box(buttons.nth(0));
    const second = await box(buttons.nth(1));
    const at = (x: number, y: number) =>
      page.evaluate(
        ([px, py]) =>
          document.elementFromPoint(px, py)?.closest(".nx-block-toolbar") !==
          null,
        [x, y] as const
      );
    const gapX = (first.x + first.width + second.x) / 2;
    const midY = first.y + first.height / 2;
    expect(await at(gapX, midY), "the gap between two buttons").toBe(false);
    expect(await at(first.x + first.width / 2, midY), "a button's middle").toBe(
      true
    );

    // Over another block the bar fades; on a button it is back.
    const opacity = () =>
      toolbar.evaluate(element => getComputedStyle(element).opacity);
    await canvasBlock(page, "block-0").hover();
    await expect.poll(opacity).toBe("0");
    await buttons.nth(0).hover();
    await expect.poll(opacity).toBe("1");
  });

  test("the selection ring and the toolbar, at Fit, 50% and 200%, and scrolled", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "block-0");
    const target = canvasBlock(page, "block-2");
    await target.click();
    const ring = canvasLayer(page).locator(
      '.nx-canvas-mark[data-mark="selected"]'
    );
    const toolbar = canvasLayer(page).locator(".nx-block-toolbar");

    const check = async (what: string): Promise<void> => {
      await expect(ring).toHaveCount(1);
      await expect
        .poll(async () => {
          const gaps = ringGaps(await box(ring), await box(target));
          return Math.max(...Object.values(gaps).map(gap => Math.abs(gap)));
        })
        .toBeLessThanOrEqual(RING_OUTSIDE + 1);
      expectRinged(await box(ring), await box(target), what);
      // The bar keeps its own size at any zoom, and sits by the block.
      const bar = await box(toolbar);
      expect(bar.height, `${what}: toolbar height`).toBeGreaterThan(24);
      expect(bar.height, `${what}: toolbar height`).toBeLessThan(48);
      const block = await box(target);
      expect(
        Math.min(
          Math.abs(bar.y + bar.height - block.y),
          Math.abs(bar.y - (block.y + block.height))
        ),
        `${what}: toolbar beside the block`
      ).toBeLessThanOrEqual(12);
    };

    await check("fit");
    await chooseZoom(page, "50%");
    await check("50%");
    await chooseZoom(page, "200%");
    await check("200%");
    await chooseZoom(page, "100%");

    // The frame's own viewport scrolled: the ring moves with the block.
    await canvasFrame(page)
      .locator(".nx-canvas")
      .evaluate(element => {
        element.ownerDocument.scrollingElement?.scrollBy(0, 150);
      });
    await check("scrolled");
  });

  test("the spacing bands sit on the block's padding at 50%", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "block-0");
    const target = canvasBlock(page, "block-1");
    await target.click();
    await chooseZoom(page, "50%");
    const top = canvasLayer(page).locator(
      '.nx-spacing-overlay__band[data-box="padding"][data-side="top"]'
    );
    await expect(top).toBeVisible();
    const band = await box(top);
    const block = await box(target);
    // 40px of padding, drawn at half size, along the block's top edge.
    expect(Math.abs(band.y - block.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(band.height - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(band.width - block.width)).toBeLessThanOrEqual(1);
  });
});

test.describe("a drag from the Add panel into the frame", () => {
  test.describe.configure({ timeout: 240_000 });
  // An account of its own: the file's earlier tests open the editor again and
  // again, and through one account these met the per-user REST limit.
  ownSeat(1);

  // A gap of the first block's own, since blocks at the page's top level
  // carry no margin and nothing between them spaces them apart.
  const NODES = [
    text("one", "The first block", {
      base: { base: { margin: { blockEnd: "24px" } } },
    }),
    text("two", "The second block"),
  ];

  async function openAdd(page: Page): Promise<Locator> {
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    const option = page.getByRole("option", { name: /^Text\b/ }).first();
    await expect(option).toBeVisible({ timeout: 15_000 });
    return option;
  }

  test("inserts at the gap the line shows, with the line drawn in the admin's document", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "one");
    const option = await openAdd(page);
    const from = await box(option);
    const one = await box(canvasBlock(page, "one"));
    const two = await box(canvasBlock(page, "two"));
    const gapY = (one.y + one.height + two.y) / 2;
    expect(two.y, "the fixture has a gap between its blocks").toBeGreaterThan(
      one.y + one.height
    );
    const x = one.x + one.width / 2;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, gapY, { steps: 24 });
    // Along the gap, as a hand settles: a new target is taken only once the
    // pointer has travelled a few pixels while it is the one under it.
    await page.mouse.move(x + 30, gapY, { steps: 6 });
    const line = canvasLayer(page).locator(".nx-drop-indicator");
    await expect(line).toHaveCount(1);
    // Exactly one line, and none inside the page.
    await expect(canvasFrame(page).locator(".nx-drop-indicator")).toHaveCount(
      0
    );
    // Drawn in the gap between the two blocks, where the release will put it.
    const drawn = await box(line);
    const lineY = drawn.y + drawn.height / 2;
    const where = `line ${String(lineY)}; one ${JSON.stringify(one)}; two ${JSON.stringify(two)}`;
    expect(lineY, where).toBeGreaterThanOrEqual(one.y + one.height - 2);
    expect(lineY, where).toBeLessThanOrEqual(two.y + 2);
    await page.mouse.up();

    await expect.poll(async () => (await structure(page)).length).toBe(3);
    const after = await structure(page);
    expect(after[0]).toBe("one");
    expect(after[2]).toBe("two");
  });

  test("inserts nothing when released back over the editor", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "one");
    const option = await openAdd(page);
    const from = await box(option);
    const one = await box(canvasBlock(page, "one"));

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(one.x + one.width / 2, one.y + one.height, {
      steps: 20,
    });
    await expect(canvasLayer(page).locator(".nx-drop-indicator")).toHaveCount(
      1
    );
    // Back over the panel, away from the row it started on, and let go.
    await page.mouse.move(from.x + from.width / 2, from.y + 200, {
      steps: 20,
    });
    await page.mouse.up();
    await expect.poll(() => structure(page)).toEqual(["one", "two"]);
  });
});
