/**
 * The editor's canvas draws the page in the SITE's colours and type, whatever
 * theme the admin around it is in.
 *
 * The canvas sits inside the admin, so anything it does not state for itself it
 * inherits from the admin: the background, the text colour, the font and the
 * colour scheme native controls and scrollbars are drawn in. In dark mode that
 * made a white site's page solid black with light text, which is a page no
 * visitor ever loads. Only a real browser can see this: jsdom applies no stylesheet and
 * resolves no inherited colour.
 *
 * The editor's own chrome drawn over the page — the block toolbar here — is the
 * other half of the contract: it stays in the ADMIN's theme and face, so it
 * reads as the editor's and remains legible on top of any page. The marks drawn
 * on the page — the selection ring — take a hue chosen for the page's ground.
 *
 * Driven through the playground's homepage Single, whose `layout` field is a
 * blocks field, and compared against the same document as the site serves it.
 *
 * @module tests/builder-canvas-colours
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "./support/test";
import { contrastRatio, gotoAdmin, toRgb, type Theme } from "./support/admin";
import { LOCK } from "./support/locks";
import { CANVAS_FRAME, canvasFrame, canvasLayer } from "./support/canvas-frame";

/**
 * How far outside a block its selection ring is drawn, in screen pixels at any
 * zoom: the ring and its halo.
 */
const RING_OUTSIDE = 4;

// Shares state with other specs; see support/locks.ts for what each lock guards.
// The canvas reads the site's tokens, which the Site Style single holds.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;
const HOMEPAGE_API = "/admin/api/singles/homepage";
const HEADING = "Canvas colours";
const PARAGRAPH = "The canvas draws this page the way a visitor sees it.";

const NODES = [
  {
    id: "intro",
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    // A background of the section's own, from a site token, so the page has a
    // surface that is the SITE's colour rather than an inherited one.
    styles: {
      base: {
        base: {
          backgroundColor: { $token: "color.surface" },
          padding: {
            blockStart: "2rem",
            blockEnd: "2rem",
            inlineStart: "2rem",
            inlineEnd: "2rem",
          },
        },
      },
    },
    slots: {
      children: [
        {
          id: "title",
          type: "core/heading",
          version: 1,
          props: { text: HEADING, level: "h1" },
        },
        {
          id: "lead",
          type: "core/text",
          version: 1,
          props: { text: PARAGRAPH },
        },
        {
          id: "cta",
          type: "core/button",
          version: 1,
          props: { label: "Get started", href: "/start" },
        },
      ],
    },
  },
  {
    id: "card",
    type: "core/text",
    version: 1,
    props: { text: "A block with a shadow of its own." },
    // Padding only: its shadow comes from a host rule the test adds, because a
    // node's own style outranks any editor rule and never showed the defect.
    styles: {
      base: {
        base: {
          padding: {
            blockStart: "1rem",
            blockEnd: "1rem",
            inlineStart: "1rem",
            inlineEnd: "1rem",
          },
        },
      },
    },
  },
  {
    id: "logo",
    type: "core/image",
    version: 1,
    props: { src: "/nextly-logo.svg", alt: "The Nextly logo" },
    styles: { base: { base: { width: "240px" } } },
  },
];

async function seed(page: Page): Promise<void> {
  const stored = await page.request.patch(HOMEPAGE_API, {
    data: {
      layout: { formatVersion: 1, kind: "page", nodes: NODES },
      _overwrite: true,
    },
  });
  expect(stored.ok(), `seeding the homepage layout: ${stored.status()}`).toBe(
    true
  );
}

/**
 * The rendered page inside the canvas, which paints the page's ground there:
 * where the canvas holds a page, its own root is transparent.
 */
function canvasPage(page: Page): Locator {
  return canvasFrame(page).locator(".nx-canvas > .nx-pb-page").first();
}

/**
 * A stylesheet in the canvas's own document, the way a page's own stylesheet
 * would style the page: the page is drawn in a frame, which the editor's
 * document's styles do not reach.
 */
async function addPageStyle(
  page: Page,
  style: { content: string }
): Promise<void> {
  const frame = await (
    await page.locator(CANVAS_FRAME).elementHandle()
  )?.contentFrame();
  if (frame === null || frame === undefined) {
    throw new Error("no canvas frame to style");
  }
  await frame.addStyleTag(style);
}

/** A block's element on the canvas, by id. */
function canvasNode(page: Page, id: string): Locator {
  return canvasFrame(page).locator(`.nx-canvas [data-nx-node="${id}"]`).first();
}

/** The selection rings drawn over the canvas, in the editor's layer. */
function rings(page: Page): Locator {
  return canvasLayer(page).locator('.nx-canvas-mark[data-mark="selected"]');
}

/** The text block's element on the canvas. */
function canvasText(page: Page): Locator {
  return canvasFrame(page).locator('.nx-canvas [data-nx-node="lead"]').first();
}

async function openBuilder(page: Page, theme: Theme): Promise<void> {
  await seed(page);
  await gotoAdmin(page, "/singles/homepage", theme);
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(canvasText(page)).toBeVisible({ timeout: 30_000 });
}

/**
 * The colour a reader actually sees behind an element: its own background, or
 * the first ancestor's that is not transparent.
 *
 * Walked rather than read off one element because the canvas and the published
 * page paint their ground at different depths — the published page leaves it
 * to the document, the canvas states it on its own root — and the question is
 * the same for both.
 */
async function groundBehind(target: Locator): Promise<string> {
  return target.evaluate(element => {
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const fill = getComputedStyle(at).backgroundColor;
      if (fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") return fill;
    }
    // Nothing painted at all: the browser's own canvas colour shows.
    return "rgb(255, 255, 255)";
  });
}

/**
 * What the published homepage paints behind the page.
 *
 * Read once the seeded heading is on screen: an empty page root has no box,
 * and a ground read before the document arrived would describe nothing.
 */
async function published(page: Page): Promise<{
  ground: [number, number, number];
  colorScheme: string;
  face: string;
}> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: HEADING, level: 1 })
  ).toBeVisible({ timeout: 30_000 });
  const root = page.locator(".nx-pb-page").first();
  return {
    ground: await toRgb(page, await groundBehind(root)),
    colorScheme: await root.evaluate(
      element => getComputedStyle(element).colorScheme
    ),
    face: await root.evaluate(element => getComputedStyle(element).fontFamily),
  };
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`with the admin in ${theme} mode`, () => {
    test("the canvas page takes the site's colours, not the admin's", async ({
      page,
      context,
    }) => {
      // The first visit to each route compiles it in the dev server.
      test.slow();
      await seed(page);
      // The published page first, in a tab of its own so the admin's theme
      // storage never reaches it.
      const site = await published(await context.newPage());

      await openBuilder(page, theme);
      const canvas = canvasFrame(page).locator(".nx-canvas");

      expect(
        await toRgb(page, await groundBehind(canvasPage(page))),
        "the page behind the blocks is the site's ground, as published"
      ).toEqual(site.ground);

      // The site's own scheme, as published: the canvas is drawn inside the
      // site's page, which states it, and never the admin's.
      expect(
        await canvas.evaluate(element => getComputedStyle(element).colorScheme),
        "native controls and scrollbars on the page follow the site, not the admin"
      ).toBe(site.colorScheme);

      // The admin's own text colour, read off the editor's chrome root.
      const adminText = await toRgb(
        page,
        await page
          .locator(".nx-builder-chrome")
          .first()
          .evaluate(element => getComputedStyle(element).color)
      );
      const pageText = await toRgb(
        page,
        await canvasText(page).evaluate(
          element => getComputedStyle(element).color
        )
      );
      if (theme === "dark") {
        expect(
          pageText,
          "the page's text is not the admin's light foreground"
        ).not.toEqual(adminText);
      }
      expect(
        contrastRatio(pageText, site.ground),
        `page text ${pageText.join(",")} must read on the site's ground`
      ).toBeGreaterThanOrEqual(4.5);

      // The page is set in the site's body font, not the admin's Geist.
      const face = await canvasText(page).evaluate(
        element => getComputedStyle(element).fontFamily
      );
      expect(face, "the page is not set in the admin's face").not.toContain(
        "Geist"
      );
      // The site's own body face, as published: the canvas is drawn inside
      // the site's page, which sets it.
      expect(
        await canvasPage(page).evaluate(
          element => getComputedStyle(element).fontFamily
        )
      ).toBe(site.face);
    });

    test("the editor's marks on the page are legible and its chrome stays the admin's", async ({
      page,
    }) => {
      test.slow();
      await openBuilder(page, theme);
      await canvasText(page).click();

      // Drawn over the canvas's frame, in the admin's document.
      const toolbar = canvasLayer(page).locator(".nx-block-toolbar");
      await expect(toolbar).toBeVisible({ timeout: 15_000 });

      expect(
        await toolbar.evaluate(
          element => getComputedStyle(element).colorScheme
        ),
        "chrome's native controls follow the admin's theme"
      ).toBe(theme);

      /*
       * The selection ring is drawn on the PAGE, so its hue is the one for the
       * page's light ground in either admin theme: the admin's primary was
       * white in the dark theme and vanished on a white page.
       */
      const selected = canvasText(page);
      await expect(selected).toHaveAttribute("data-nx-selected", /.*/);
      // The ring is a mark drawn over the block, in the editor's layer.
      await expect(rings(page)).toHaveCount(1);
      const ring = await toRgb(
        page,
        await rings(page).evaluate(
          element => getComputedStyle(element).outlineColor
        )
      );
      expect(ring, "the selection ring is the select blue").toEqual([
        37, 99, 235,
      ]);
      const ground = await toRgb(page, await groundBehind(canvasPage(page)));
      expect(
        contrastRatio(ring, ground),
        "the ring stands out from the page it is drawn on"
      ).toBeGreaterThanOrEqual(3);

      /*
       * The bar of block actions is a dark ink with light text in both themes,
       * so it reads the same on any page and is legible on its own surface.
       */
      const toolbarText = await toRgb(
        page,
        await toolbar
          .locator("button")
          .first()
          .evaluate(element => getComputedStyle(element).color)
      );
      const toolbarFill = await toRgb(
        page,
        await toolbar.evaluate(
          element => getComputedStyle(element).backgroundColor
        )
      );
      expect(
        contrastRatio(toolbarFill, [0, 0, 0]),
        `the toolbar is a dark bar, not ${toolbarFill.join(",")}`
      ).toBeLessThan(1.5);
      expect(
        contrastRatio(toolbarText, toolbarFill),
        "the toolbar stays legible on its own surface"
      ).toBeGreaterThanOrEqual(4.5);

      // The bar keeps the admin's face; the page around it does not.
      expect(
        await toolbar
          .locator("button")
          .first()
          .evaluate(element => getComputedStyle(element).fontFamily),
        "the toolbar is set in the admin's face"
      ).toContain("Geist");
      // So do the spacing overlay's value chips, which are chrome without the
      // chrome marker: they take no pointer events.
      const chip = canvasLayer(page)
        .locator(".nx-spacing-overlay__value")
        .first();
      await expect(chip).toBeVisible();
      expect(
        await chip.evaluate(element => getComputedStyle(element).fontFamily),
        "the spacing values are set in the admin's face"
      ).toContain("Geist");
    });
  });
}

test.describe("with the system in dark mode", () => {
  test("the canvas page follows the site's own dark mode, not the admin's light one", async ({
    page,
    context,
  }) => {
    /*
     * The playground's site darkens with the system (its strategy is `media`),
     * while the admin here is pinned to LIGHT. The canvas is drawn inside the
     * site's own page, so it goes dark exactly as the published page does:
     * the same ground and the same colour scheme, never the admin's.
     */
    test.slow();
    await page.emulateMedia({ colorScheme: "dark" });
    await seed(page);
    const sitePage = await context.newPage();
    await sitePage.emulateMedia({ colorScheme: "dark" });
    const site = await published(sitePage);
    expect(
      contrastRatio(site.ground, [0, 0, 0]),
      "the published page is dark with the system in dark"
    ).toBeLessThan(1.5);

    await openBuilder(page, "light");
    const canvas = canvasFrame(page).locator(".nx-canvas");
    expect(
      await canvas.evaluate(element => getComputedStyle(element).colorScheme)
    ).toBe(site.colorScheme);
    const ground = await toRgb(page, await groundBehind(canvasPage(page)));
    expect(ground, "the canvas ground is the published page's").toEqual(
      site.ground
    );
    const pageText = await toRgb(
      page,
      await canvasText(page).evaluate(
        element => getComputedStyle(element).color
      )
    );
    expect(
      contrastRatio(pageText, ground),
      `page text ${pageText.join(",")} must read on the dark page`
    ).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("selecting a block", () => {
  test("keeps the shadow the page gives it, with the halo drawn beside the ring", async ({
    page,
  }) => {
    /*
     * The halo used to be an inset `box-shadow` on the selected block, which
     * replaced any shadow of the block's own, so the selected page drew
     * differently from the published one. It is a separate layer now.
     */
    test.slow();
    await openBuilder(page, "light");
    /*
     * A shadow at the weight a host stylesheet or an element default has —
     * below the editor's selection rule — which is where selecting a block
     * used to replace it.
     */
    await addPageStyle(page, {
      content: ".nx-pb-page p { box-shadow: 0 4px 12px #00000040; }",
    });
    const card = canvasNode(page, "card");
    const shadowOf = () =>
      card.evaluate(element => getComputedStyle(element).boxShadow);
    const before = await shadowOf();
    expect(before, "the fixture block has a shadow of its own").not.toBe(
      "none"
    );

    await card.click();
    await expect(card).toHaveAttribute("data-nx-selected", "primary");
    expect(await shadowOf(), "selecting the block keeps its shadow").toBe(
      before
    );

    // The halo is measured onto the selected block: its box is the block's
    // grown by the ring's distance on every edge, and the band is drawn just
    // inside that, as the ring is.
    const halo = rings(page);
    await expect(halo).toHaveCount(1);
    const block = await card.boundingBox();
    const band = await halo.boundingBox();
    expect(block && band, "both boxes are measurable").toBeTruthy();
    if (block && band) {
      const gaps = {
        left: block.x - band.x,
        top: block.y - band.y,
        right: band.x + band.width - (block.x + block.width),
        bottom: band.y + band.height - (block.y + block.height),
      };
      for (const [edge, gap] of Object.entries(gaps)) {
        expect(
          gap,
          `the halo's ${edge} stands outside the block`
        ).toBeGreaterThan(RING_OUTSIDE - 1);
        expect(gap, `the halo's ${edge} is beside it`).toBeLessThan(
          RING_OUTSIDE + 1
        );
      }
    }
  });
  test("leaves an anchor the page gives the block, and what it anchors, in place", async ({
    page,
  }) => {
    /*
     * The halo is measured and drawn by the editor, so nothing about it is
     * written onto the page's elements. An `anchor-name` on the selected block
     * once was, which renamed the PAGE's own anchor in the editor alone and
     * moved whatever the page positioned against it.
     */
    test.slow();
    await openBuilder(page, "light");
    // The page's own anchor on the card, at a host stylesheet's weight, and the
    // title positioned against it.
    await addPageStyle(page, {
      content: [
        ".nx-pb-page p { anchor-name: --page-card; }",
        ".nx-pb-page h1 { position: absolute; position-anchor: --page-card;",
        "  top: anchor(bottom); left: anchor(left); }",
      ].join("\n"),
    });
    const card = canvasNode(page, "card");
    const title = canvasNode(page, "title");
    const anchorOf = () =>
      card.evaluate(element => getComputedStyle(element).anchorName);
    expect(await anchorOf(), "the fixture anchors the card").toBe(
      "--page-card"
    );
    // The page's image draws once its file arrives, and moves what is below
    // it: measured after, so the only thing that can move the title is the
    // selection.
    await expect
      .poll(() =>
        canvasFrame(page)
          .locator(".nx-canvas img")
          .evaluateAll(
            images =>
              images.length > 0 &&
              images.every(image => (image as HTMLImageElement).complete)
          )
      )
      .toBe(true);
    const before = await title.boundingBox();

    await card.click();
    await expect(card).toHaveAttribute("data-nx-selected", "primary");
    expect(await anchorOf(), "selecting the card keeps its anchor").toBe(
      "--page-card"
    );
    expect(
      await title.boundingBox(),
      "what the page anchors to the card stays where it was"
    ).toEqual(before);
  });
});

/**
 * The colours a screenshot of a page region shows, decoded by the browser —
 * the suite carries no image decoder of its own, and the engine that painted
 * the pixels is the one to read them.
 */
async function pixelsIn(
  page: Page,
  clip: { x: number; y: number; width: number; height: number }
): Promise<[number, number, number][]> {
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async encoded => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("No 2d context");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const out: [number, number, number][] = [];
    for (let index = 0; index < data.length; index += 4) {
      out.push([data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0]);
    }
    return out;
  }, png);
}

test.describe("the selection halo", () => {
  /*
   * Opens the editor with `css` styling the card the way a page's own
   * stylesheet would, selects an ordinary block first — whose halo proves the
   * layer is measuring — then the card.
   */
  async function selectCardWith(page: Page, css: string): Promise<Locator> {
    await openBuilder(page, "light");
    await addPageStyle(page, { content: css });
    await canvasText(page).click();
    await expect(rings(page)).toHaveCount(1);
    const card = canvasNode(page, "card");
    await card.click();
    await expect(card).toHaveAttribute("data-nx-selected", "primary");
    return card;
  }

  test("follows the block's own rounded corners, at the canvas's scale", async ({
    page,
  }) => {
    test.slow();
    const card = await selectCardWith(
      page,
      ".nx-pb-page p[data-nx-node='card'] { border-radius: 12px; }"
    );
    const halo = rings(page);
    await expect(halo).toHaveCount(1);
    expect(
      await card.evaluate(
        element => getComputedStyle(element).borderTopLeftRadius
      )
    ).toBe("12px");
    // Drawn over the frame at the frame's painted scale: the corner is the
    // block's 12px as the author sees it on screen, grown by the distance the
    // ring stands outside it, so the two curves stay concentric.
    const scale = await card.evaluate(element => {
      const el = element as HTMLElement;
      const frame = el.ownerDocument.defaultView?.frameElement as
        | HTMLElement
        | null
        | undefined;
      return frame === null || frame === undefined
        ? 1
        : frame.getBoundingClientRect().width / frame.offsetWidth;
    });
    await expect
      .poll(
        async () =>
          Math.abs(
            parseFloat(
              await halo.evaluate(
                element => getComputedStyle(element).borderTopLeftRadius
              )
            ) -
              (12 * scale + RING_OUTSIDE)
          ),
        { message: "the ring's corner follows the block's" }
      )
      .toBeLessThan(0.5);
  });

  for (const [name, css] of [
    [
      "rotated, skewed or reflected",
      ".nx-pb-page p[data-nx-node='card'] { transform: rotate(4deg); }",
    ],
    [
      "cut off by an ancestor",
      ".nx-pb-page { overflow: hidden; } .nx-pb-page p[data-nx-node='card'] { margin-left: -48px; }",
    ],
  ] as const) {
    test(`still rings a block ${name}`, async ({ page }) => {
      /*
       * Over the frame the ring drawn in the editor's layer is the only one a
       * block has: nothing of the editor's is drawn onto the page's elements.
       * So a shape the layer's upright box cannot reproduce keeps a ring
       * around its box rather than losing it.
       */
      test.slow();
      const card = await selectCardWith(page, css);
      await expect(rings(page)).toHaveCount(1);
      expect(
        await card.evaluate(element => getComputedStyle(element).outlineStyle),
        "nothing is drawn onto the page's own element"
      ).toBe("none");
    });
  }

  test("stays above page content a site stacks high", async ({ page }) => {
    /*
     * A site's `z-index: 5` used to lift its block over the halo layer. The
     * page is one stacking context now, so the band still shows on top.
     */
    test.slow();
    const card = await selectCardWith(
      page,
      ".nx-pb-page { background: #111827; } .nx-pb-page p[data-nx-node='card'] { position: relative; z-index: 5; background: #2563eb; }"
    );
    await expect(rings(page)).toHaveCount(1);
    const box = await card.boundingBox();
    expect(box, "the card is measurable").not.toBeNull();
    if (box === null) return;
    // A short column across the ring, which stands just outside the card's
    // top edge: ring, then band, then the card. Near the left end rather than
    // the middle, where the spacing overlay's value chip sits over the edge.
    const column = await pixelsIn(page, {
      x: Math.round(box.x + box.width / 4),
      y: Math.floor(box.y) - 6,
      width: 1,
      height: 8,
    });
    /*
     * Near white rather than pure: the spacing overlay's band tints what is
     * under it. The page's ground is near black and the card a saturated blue,
     * so a light pixel there can only be the halo band.
     */
    expect(
      column.some(([r, g, b]) => Math.min(r, g, b) > 180),
      `the white band shows over the card: ${JSON.stringify(column)}`
    ).toBe(true);
  });
});

test.describe("a page's own background", () => {
  test("wins over the site ground the canvas lays under it", async ({
    page,
  }) => {
    /*
     * The page's styles compile its background onto the page root. Behind an
     * opaque site ground the canvas also paints that ground on the page root,
     * as a weightless fallback, so the page's own background still shows — as
     * it does when published.
     */
    test.slow();
    const stored = await page.request.patch(HOMEPAGE_API, {
      data: {
        layout: {
          formatVersion: 1,
          kind: "page",
          settings: {
            styles: { base: { base: { backgroundColor: "#fde68a" } } },
          },
          nodes: NODES,
        },
        _overwrite: true,
      },
    });
    expect(stored.ok(), `seeding the page: ${stored.status()}`).toBe(true);
    await gotoAdmin(page, "/singles/homepage", "light");
    await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
    await expect(canvasText(page)).toBeVisible({ timeout: 30_000 });
    // The fallback is in play: the default site ground is opaque.
    await expect(canvasFrame(page).locator(".nx-canvas")).toHaveAttribute(
      "data-nx-site-ground-opaque",
      ""
    );
    await expect
      .poll(() =>
        canvasPage(page).evaluate(
          element => getComputedStyle(element).backgroundColor
        )
      )
      .toBe("rgb(253, 230, 138)");
  });
});

test.describe("a translucent site ground", () => {
  test("is composited once over what sits behind the canvas", async ({
    page,
  }) => {
    /*
     * The ground is painted on ONE surface. Laid on the canvas root and again
     * on the page root, a half-transparent ground composited over itself and
     * the editor's page read darker than the published one.
     */
    test.slow();
    // Stored as the site's own ground, the way an author sets it, and cleared
    // afterwards: the e2e site stores no tokens of its own.
    const SITE_STYLE = "/admin/api/singles/site-style";
    const stored = await page.request.patch(SITE_STYLE, {
      data: {
        tokens: {
          tokens: [
            {
              name: "color.background",
              kind: "color",
              values: { light: "rgb(0 0 0 / 50%)" },
            },
          ],
        },
        _overwrite: true,
      },
    });
    expect(stored.ok(), `storing the ground: ${stored.status()}`).toBe(true);
    // On the editor's blank page, which paints the site's ground itself. A
    // page the site serves paints its own, as it does published, so the site's
    // canvas route is answered as missing and the editor falls back.
    await page.route("**/page-builder-canvas", async route => {
      // A thrown handler prints the request, headers and all; answer instead.
      try {
        await route.fulfill({
          status: 404,
          contentType: "text/html",
          body: "<!doctype html><html><body><main>Not found</main></body></html>",
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    try {
      await openBuilder(page, "light");
      await expectGroundOnce(page);
    } finally {
      const cleared = await page.request.patch(SITE_STYLE, {
        data: { tokens: null, _overwrite: true },
      });
      expect(cleared.ok(), `clearing the ground: ${cleared.status()}`).toBe(
        true
      );
    }
  });
});

/** One layer of the half-transparent ground over what sits behind the canvas. */
async function expectGroundOnce(page: Page): Promise<void> {
  const canvas = canvasFrame(page).locator(".nx-canvas");
  // What the canvas sits on: the first painted surface above it.
  const backdrop = await toRgb(
    page,
    await canvas.evaluate(element => {
      for (let at = element.parentElement; at !== null; at = at.parentElement) {
        const fill = getComputedStyle(at).backgroundColor;
        if (fill !== "rgba(0, 0, 0, 0)" && fill !== "transparent") return fill;
      }
      return "rgb(255, 255, 255)";
    })
  );
  /*
   * A spot of bare page: a gap the test opens above the card, where nothing
   * but the page's ground is painted.
   */
  await addPageStyle(page, {
    content: ".nx-pb-page p[data-nx-node='card'] { margin-top: 48px; }",
  });
  const card = canvasNode(page, "card");
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box, "the card is measurable").not.toBeNull();
  if (box === null) return;
  const [pixel] = await pixelsIn(page, {
    x: Math.round(box.x + box.width / 4),
    y: Math.round(box.y - 12),
    width: 1,
    height: 1,
  });
  // One layer of half-transparent black over the backdrop.
  const once = backdrop.map(channel => Math.round(channel / 2));
  for (const [index, channel] of (pixel ?? [0, 0, 0]).entries()) {
    expect(
      Math.abs(channel - (once[index] ?? 0)),
      `channel ${index}: ${JSON.stringify(pixel)} against one layer ${JSON.stringify(once)}`
    ).toBeLessThanOrEqual(2);
  }
}
