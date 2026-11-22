/**
 * A container's text colour and type reach the blocks inside it, on the
 * canvas and on the live page alike, measured in a browser:
 *
 * 1. A dark Section with white text, the Links row unset: a Heading, a Text,
 *    the link in the Text and a List all compute white.
 * 2. The same with a Links row colour: the link computes the row's colour,
 *    the rest stay white.
 * 3. A Heading wearing a block style with a colour, and one taking the ★
 *    default block style with a colour: each keeps its own colour.
 * 4. A Heading and a Text with their own colour: each keeps it.
 * 5. A white Box with dark text inside the dark Section, holding a link: the
 *    link computes the Box's colour.
 * 6. A link outside any coloured container, Links row unset: the browser's
 *    link colour, as today.
 * 7. A Section with its own font and size: the Heading keeps its Site text
 *    size and line height and takes the Section's font; the Text takes all
 *    three.
 *
 * Each case compares computed colour, font family, size and line height on
 * the canvas and on the published page, which use the same compiler.
 *
 * Also: a new Section's Style › Spacing says its padding comes from "Site
 * default: Section spacing", and a new Box's padding is 0.
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  block,
  clickBlock,
  openEditorWith,
  selection,
} from "./canvas/editor-driver";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

test.describe.configure({
  mode: "serial",
  lock: [LOCK.homepage, LOCK.siteStyle],
});

const SITE_STYLE = "/admin/api/singles/site-style";
const ENTRIES = "/admin/api/collections/block-pages/entries";
const PAGE_SLUG = "container-text";

const WHITE = "rgb(255, 255, 255)";
const ACCENT = "rgb(255, 102, 0)";
const STARRED = "rgb(51, 102, 255)";
const OWN_HEADING = "rgb(0, 204, 136)";
const OWN_TEXT = "rgb(255, 204, 0)";
const BOX_TEXT = "rgb(34, 34, 34)";
const LINKS_ROW = "rgb(255, 0, 170)";
/** The browser's own colour for a link not yet visited. */
const BROWSER_LINK = "rgb(0, 0, 238)";

/** A Text holding words and one link. */
function linkedText(id: string, words: string, link: string) {
  return {
    id,
    type: "core/text",
    version: 2,
    props: {
      text: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [
                { type: "text", text: `${words} ` },
                {
                  type: "link",
                  url: "/blocks/container-text",
                  children: [{ type: "text", text: link }],
                },
              ],
            },
          ],
        },
      },
    },
  };
}

const plainText = (id: string, words: string, styles?: unknown) => ({
  ...linkedText(id, words, ""),
  props: {
    text: {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [{ type: "text", text: words }] },
        ],
      },
    },
  },
  ...(styles === undefined ? {} : { styles }),
});

const heading = (
  id: string,
  text: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
  ...extra,
});

const colour = (color: string) => ({ base: { base: { color } } });

const NODES = [
  {
    id: "ct-dark",
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    styles: {
      base: { base: { backgroundColor: "#111827", color: "#ffffff" } },
    },
    slots: {
      children: [
        heading("ct-heading", "Plain heading"),
        linkedText("ct-text", "Read the", "section link"),
        {
          id: "ct-list",
          type: "core/list",
          version: 1,
          props: { items: ["First point", "Second point"] },
        },
        heading("ct-accent", "Accent heading", {
          classes: ["look:core/heading:accent"],
        }),
        heading("ct-own", "Own heading", { styles: colour("#00cc88") }),
        plainText("ct-own-text", "Own text", colour("#ffcc00")),
        {
          id: "ct-box",
          type: "core/box",
          version: 1,
          props: { as: "div" },
          styles: {
            base: { base: { backgroundColor: "#ffffff", color: "#222222" } },
          },
          slots: {
            children: [linkedText("ct-box-text", "In the", "box link")],
          },
        },
      ],
    },
  },
  linkedText("ct-outside", "Outside any colour, a", "plain link"),
  {
    id: "ct-typed",
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    styles: {
      base: {
        base: {
          fontFamily: "Georgia, serif",
          fontSize: "20px",
          lineHeight: 1.9,
        },
      },
    },
    slots: {
      children: [
        heading("ct-typed-heading", "Typed heading"),
        plainText("ct-typed-text", "Typed text"),
      ],
    },
  },
];

/** The Heading block style with a colour, as a site's library holds one. */
const ACCENT_LOOK = {
  id: "look:core/heading:accent",
  slug: "heading-accent",
  label: "Accent",
  orderIndex: 0,
  blockType: "core/heading",
  styles: colour("#ff6600"),
};
/** A Heading block style marked ★, the default of every heading wearing none. */
const STARRED_LOOK = {
  id: "look:core/heading:starred",
  slug: "heading-starred",
  label: "Starred",
  orderIndex: 1,
  blockType: "core/heading",
  starred: true,
  styles: colour("#3366ff"),
};

interface Computed {
  color: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
}

function computed(locator: Locator): Promise<Computed> {
  return locator.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
    };
  });
}

/** The elements each case measures, on one surface. */
type Surface = Record<string, Locator>;

const MEASURED = [
  "heading",
  "text",
  "link",
  "list",
  "accent",
  "own",
  "ownText",
  "boxLink",
  "outsideLink",
  "typedHeading",
  "typedText",
] as const;

/** The measured elements on the canvas, found by their blocks. */
async function canvasSurface(page: Page): Promise<Surface> {
  const inner = async (id: string, tag: string) => {
    const node = await block(page, id);
    return node
      .locator(tag)
      .or(node.and(node.page().locator(tag)))
      .first();
  };
  return {
    heading: await inner("ct-heading", "h2"),
    text: await inner("ct-text", "p"),
    link: (await block(page, "ct-text")).locator("a"),
    list: (await block(page, "ct-list")).locator("li").first(),
    accent: await inner("ct-accent", "h2"),
    own: await inner("ct-own", "h2"),
    ownText: await inner("ct-own-text", "p"),
    boxLink: (await block(page, "ct-box-text")).locator("a"),
    outsideLink: (await block(page, "ct-outside")).locator("a"),
    typedHeading: await inner("ct-typed-heading", "h2"),
    typedText: await inner("ct-typed-text", "p"),
  };
}

/** The measured elements on the published page, found as a visitor reads them. */
function liveSurface(page: Page): Surface {
  return {
    heading: page.getByRole("heading", { name: "Plain heading" }),
    text: page.locator("p", { hasText: "Read the" }),
    link: page.getByRole("link", { name: "section link" }),
    list: page.getByText("First point"),
    accent: page.getByRole("heading", { name: "Accent heading" }),
    own: page.getByRole("heading", { name: "Own heading" }),
    ownText: page.locator("p", { hasText: "Own text" }),
    boxLink: page.getByRole("link", { name: "box link" }),
    outsideLink: page.getByRole("link", { name: "plain link" }),
    typedHeading: page.getByRole("heading", { name: "Typed heading" }),
    typedText: page.locator("p", { hasText: "Typed text" }),
  };
}

/**
 * Take the host's own colour off bare `a` rules in the document a locator is
 * in, as on a site with no CSS reset.
 *
 * The playground's reset gives every link `color: inherit`, which a host rule
 * on `a` may do and which beats a container's zero-specificity link rule (the
 * docs say so). Left in, it makes a link inherit with or without the rule
 * under test, and a link outside any container lose the browser's colour.
 * The page's own rules are kept: none is a bare `a`.
 */
async function withoutHostLinkColour(locator: Locator): Promise<void> {
  await locator.evaluate(element => {
    const bare = /(^|,)\s*a\s*(,|$)/;
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule && bare.test(rule.selectorText)) {
          rule.style.removeProperty("color");
        }
        if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of element.ownerDocument.styleSheets) {
      try {
        visit(sheet.cssRules);
      } catch {
        // A sheet from another origin cannot be read, nor hold a host reset.
      }
    }
  });
}

/** Each measured element's computed values, by its name. */
type Measures = Record<(typeof MEASURED)[number], Computed>;

async function measure(surface: Surface): Promise<Measures> {
  await withoutHostLinkColour(surface.heading as Locator);
  const out: Partial<Measures> = {};
  for (const name of MEASURED) out[name] = await computed(surface[name]);
  return out as Measures;
}

async function storeSiteStyle(
  api: APIRequestContext,
  data: { classes?: unknown[]; tokens?: unknown }
): Promise<void> {
  const response = await api.patch(SITE_STYLE, {
    data: { ...data, _overwrite: true },
  });
  expect(response.ok(), `writing the site style: ${response.status()}`).toBe(
    true
  );
}

async function storedTokens(api: APIRequestContext): Promise<unknown> {
  const response = await api.get(SITE_STYLE);
  const body = (await response.json()) as Record<string, unknown>;
  const item = (body.item ?? body) as Record<string, unknown>;
  const raw = item.tokens ?? null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

/**
 * Both surfaces' measures once the site style written has reached them: the
 * canvas opened afresh, and the published page read again until its cached
 * render follows the write.
 */
async function bothSurfaces(
  page: Page,
  ready: (live: Measures) => boolean
): Promise<{ canvas: Measures; live: Measures }> {
  let live: Measures | undefined;
  await expect
    .poll(
      async () => {
        await page.goto(`/blocks/${PAGE_SLUG}`);
        live = await measure(liveSurface(page));
        return ready(live);
      },
      { timeout: 60_000 }
    )
    .toBe(true);
  const seeded = await page.request.patch("/admin/api/singles/homepage", {
    data: {
      layout: { formatVersion: 1, kind: "page", nodes: NODES },
      _overwrite: true,
    },
  });
  expect(seeded.ok(), `seeding the homepage: ${await seeded.text()}`).toBe(
    true
  );
  await openEditorWith(page, NODES, "ct-heading");
  const surface = await canvasSurface(page);
  // The canvas applies the site style once it has loaded it.
  await expect
    .poll(async () => (await computed(surface.typedText)).fontSize)
    .toBe("20px");
  return { canvas: await measure(surface), live: live as Measures };
}

let before: { classes: unknown; tokens: unknown } | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    const read = await api.get(SITE_STYLE);
    const body = (await read.json()) as Record<string, unknown>;
    const item = (body.item ?? body) as Record<string, unknown>;
    before = { classes: item.classes ?? [], tokens: await storedTokens(api) };
    const created = await api.post(ENTRIES, {
      data: {
        title: "Container text",
        slug: PAGE_SLUG,
        content: { formatVersion: 1, kind: "page", nodes: NODES },
        status: "published",
      },
    });
    if (created.status() !== 409) {
      expect(
        created.ok(),
        `seeding ${PAGE_SLUG}: ${await created.text()}`
      ).toBe(true);
    }
  } finally {
    await api.dispose();
  }
});

test.afterAll(async ({ playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined || before === undefined) return;
  const api = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });
  try {
    await api.patch("/admin/api/singles/homepage", {
      data: {
        layout: { formatVersion: 1, kind: "page", nodes: [] },
        _overwrite: true,
      },
    });
    await storeSiteStyle(api, {
      classes: (before.classes as unknown[]) ?? [],
      tokens: before.tokens,
    });
  } finally {
    await api.dispose();
  }
});

test("a dark Section's white text reaches every block inside it, links included, on the canvas and the live page alike", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await storeSiteStyle(page.request, {
    classes: [ACCENT_LOOK],
    tokens: { tokens: [] },
  });
  const { canvas, live } = await bothSurfaces(
    page,
    measured => measured.accent.color === ACCENT
  );
  for (const surface of [canvas, live]) {
    // 1: the Heading, the Text, its link and the List are white.
    expect(surface.heading.color).toBe(WHITE);
    expect(surface.text.color).toBe(WHITE);
    expect(surface.link.color).toBe(WHITE);
    expect(surface.list.color).toBe(WHITE);
    // 3: a block style's colour wins inside the Section.
    expect(surface.accent.color).toBe(ACCENT);
    // 4: a block's own colour wins.
    expect(surface.own.color).toBe(OWN_HEADING);
    expect(surface.ownText.color).toBe(OWN_TEXT);
    // 5: a link in a Box with its own text colour takes the Box's.
    expect(surface.boxLink.color).toBe(BOX_TEXT);
    // 6: a link outside any coloured container keeps the browser's colour.
    expect(surface.outsideLink.color).toBe(BROWSER_LINK);
    // 7: the Heading keeps its Site text size and line height and takes the
    // Section's font; the Text takes all three.
    expect(surface.typedHeading.fontFamily).toBe("Georgia, serif");
    expect(surface.typedHeading.fontSize).toBe("28px");
    expect(surface.typedText.fontFamily).toBe("Georgia, serif");
    expect(surface.typedText.fontSize).toBe("20px");
    expect(surface.typedText.lineHeight).toBe("38px");
  }
  // The canvas and the live page compute the same values for every case.
  expect(canvas).toEqual(live);
  // The heading's line height is its Site text row's, not the Section's.
  expect(live.typedHeading.lineHeight).not.toBe("53.2px");
});

test("a Links row colour wins over the container's, and only on links", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await storeSiteStyle(page.request, {
    classes: [ACCENT_LOOK],
    tokens: { tokens: [], siteText: { link: { color: "#ff00aa" } } },
  });
  const { canvas, live } = await bothSurfaces(
    page,
    measured => measured.link.color === LINKS_ROW
  );
  for (const surface of [canvas, live]) {
    // 2: the link takes the row's colour; the rest stay white.
    expect(surface.link.color).toBe(LINKS_ROW);
    expect(surface.boxLink.color).toBe(LINKS_ROW);
    expect(surface.outsideLink.color).toBe(LINKS_ROW);
    expect(surface.heading.color).toBe(WHITE);
    expect(surface.text.color).toBe(WHITE);
    expect(surface.list.color).toBe(WHITE);
  }
  expect(canvas).toEqual(live);
});

test("a Heading taking the ★ block style keeps its colour inside the white Section", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await storeSiteStyle(page.request, {
    classes: [ACCENT_LOOK, STARRED_LOOK],
    tokens: { tokens: [] },
  });
  const { canvas, live } = await bothSurfaces(
    page,
    measured => measured.heading.color === STARRED
  );
  for (const surface of [canvas, live]) {
    // 3: the ★ style's colour wins over the Section's; a block style worn
    // and a block's own colour still win over the ★.
    expect(surface.heading.color).toBe(STARRED);
    expect(surface.accent.color).toBe(ACCENT);
    expect(surface.own.color).toBe(OWN_HEADING);
    expect(surface.text.color).toBe(WHITE);
  }
  expect(canvas).toEqual(live);
});

test("a new Section's padding says it comes from the site's section spacing, and a new Box's is 0", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(
    page,
    [
      {
        id: "ct-new-section",
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        slots: { children: [heading("ct-new-heading", "In a new section")] },
      },
      {
        id: "ct-new-box",
        type: "core/box",
        version: 1,
        props: { as: "div" },
        slots: { children: [heading("ct-box-heading", "In a new box")] },
      },
    ],
    "ct-new-heading"
  );
  const inspector = page.getByTestId("inspector");
  const openSpacing = async (child: string, container: string) => {
    await clickBlock(page, child);
    await page.keyboard.press("Escape");
    await expect.poll(() => selection(page)).toEqual([container]);
    await inspector.getByRole("tab", { name: "Style" }).click();
    const spacing = inspector.getByRole("button", { name: /^Spacing/ });
    if ((await spacing.getAttribute("aria-expanded")) !== "true") {
      await spacing.click();
    }
    return page.locator(".nx-spacing-box");
  };
  const sectionBox = await openSpacing("ct-new-heading", "ct-new-section");
  const source = sectionBox.locator("[data-site-default]");
  await expect(source).toBeVisible();
  await expect(source).toHaveText("Site default: Section spacing");
  await expect(
    sectionBox.getByText("Section padding (top and bottom)").first()
  ).toBeVisible();
  // The canvas draws the padding the line names.
  const section = await block(page, "ct-new-section");
  const padding = await section.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.paddingTop, style.paddingBottom];
  });
  expect(Number.parseFloat(padding[0] ?? "0")).toBeGreaterThanOrEqual(48);
  expect(padding[0]).toBe(padding[1]);

  const boxBox = await openSpacing("ct-box-heading", "ct-new-box");
  await expect(boxBox.locator("[data-site-default]")).toHaveCount(0);
  const box = await block(page, "ct-new-box");
  expect(
    await box.evaluate(element => getComputedStyle(element).paddingTop)
  ).toBe("0px");
});
