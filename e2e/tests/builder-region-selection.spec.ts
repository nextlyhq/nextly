/**
 * The header and footer on the canvas, selected as a whole: from the canvas
 * or from Layers, the sidebar says what it is, where it comes from, how many
 * pages show it and how to change it; Delete removes nothing and says why;
 * its marks are drawn inside it, never over the page; the pointer crossing
 * its edge switches the outline once.
 *
 * Seeded through the admin API: a header and a footer component, a
 * published set made the site's default, a page whose first and last blocks
 * start with text, and an empty page. The site's previous default is put
 * back afterwards.
 *
 * @module tests/builder-region-selection.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  announcer,
  block,
  boxOf,
  canvasRoot,
  clickBlock,
  openLayers,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

// Each test opens the builder, whose first draw on a dev server is slow.
test.describe.configure({
  mode: "serial",
  lock: [LOCK.siteDefaultLayout],
  timeout: 120_000,
});

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SET = `Regions ${STAMP}`;
const HEADER_TEXT = `Ridgeline ${STAMP}`;
const FOOTER_TEXT = `Survey Co ${STAMP}`;
const FIRST = "first";
const LAST = "last";

interface Seeded {
  page: string;
  empty: string;
  previousDefault: string | null;
}

let seeded: Seeded | undefined;

async function idOf(
  response: {
    ok(): boolean;
    status(): number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  },
  what: string
): Promise<string> {
  expect(
    response.ok(),
    `${what}: ${response.status()} ${await response.text()}`
  ).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text, level: "h2" } };
}

function paragraph(id: string, text: string) {
  return { id, type: "core/paragraph", version: 1, props: { text } };
}

async function component(
  api: APIRequestContext,
  slug: string,
  text: string
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: slug,
        slug: `${slug}-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "component",
          // Two lines, as tall as a site's own header or footer is: room for
          // the tag inside it.
          nodes: [
            heading("h", text),
            paragraph("p", "Land and site surveys since 2004"),
          ],
        },
        status: "published",
      },
    }),
    `creating ${slug}`
  );
}

async function makeDefault(page: Page, id: string): Promise<void> {
  const csrf = (await (await page.request.get(`${API}/auth/csrf`)).json()) as {
    token: string;
  };
  const made = await page.request.post(`${PLUGIN}/layouts/${id}/make-default`, {
    headers: { "x-csrf-token": csrf.token, origin: new URL(page.url()).origin },
    data: {},
  });
  expect(made.ok(), `make-default: ${made.status()} ${await made.text()}`).toBe(
    true
  );
}

async function pageWith(
  api: APIRequestContext,
  slug: string,
  nodes: readonly object[]
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/pages/entries`, {
      data: {
        title: `${slug} ${STAMP}`,
        slug: `${slug}-${STAMP}`,
        content: { formatVersion: 1, kind: "page", nodes },
      },
    }),
    `creating ${slug}`
  );
}

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const api = page.request;
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as { meta: { defaultLayout: string | null } };
  const header = await component(api, "regions-header", HEADER_TEXT);
  const footer = await component(api, "regions-footer", FOOTER_TEXT);
  const set = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: SET,
        slug: `regions-${STAMP}`,
        areas: [
          { area: "header", component: header },
          { area: "footer", component: footer },
        ],
        status: "published",
      },
    }),
    "creating the set"
  );
  await makeDefault(page, set);
  // Its first and last blocks start with text, where a mark hanging past
  // the header or footer covered "Section title".
  const withText = await pageWith(api, "regions-page", [
    heading(FIRST, "Section title"),
    paragraph("middle", "Words in between."),
    paragraph(LAST, "Closing words"),
  ]);
  const empty = await pageWith(api, "regions-empty", []);
  seeded = {
    page: withText,
    empty,
    previousDefault: choices.meta.defaultLayout,
  };
  return seeded;
}

test.afterAll(async ({ browser }) => {
  if (seeded?.previousDefault == null) return;
  const page = await browser.newPage();
  try {
    await gotoAdmin(page, "/");
    await makeDefault(page, seeded.previousDefault);
  } finally {
    await page.close();
  }
});

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(await region(page, "header")).toContainText(HEADER_TEXT, {
    timeout: 30_000,
  });
}

async function region(page: Page, area: "header" | "footer"): Promise<Locator> {
  return (await canvasRoot(page)).locator(`[data-nx-region="${area}"]`);
}

/** The sidebar's card for the selected header or footer. */
function card(page: Page, name: "Site header" | "Site footer"): Locator {
  return page.getByRole("complementary").getByRole("region", { name });
}

/** The words the card says of where it comes from, any count of pages. */
function reachLine(area: "header" | "footer"): RegExp {
  void area;
  return new RegExp(
    `From the ${SET} header & footer\\. It shows on (at least )?\\d+ pages?, so changes here change all of them\\.`
  );
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

async function boxIn(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("[e2e] no box");
  return box;
}

test("selects the header from the canvas, and the sidebar says where it comes from instead of the last block's settings", async ({
  page,
}) => {
  const { page: id } = await seed(page);
  await openBuilder(page, id);

  // A heading selected first: its settings are in the sidebar.
  await clickBlock(page, FIRST);
  await expect(
    page.getByRole("complementary").getByRole("tab", { name: "Content" })
  ).toBeVisible();

  const header = await region(page, "header");
  await header.click();
  expect(await selection(page)).toEqual([]);
  await expect(header).toHaveAttribute("aria-pressed", "true");
  await expect(header.locator(".nx-canvas-region__tag")).toHaveText(
    "Site header"
  );
  await expect(header.locator(".nx-canvas-region__tag")).toBeVisible();

  const shown = card(page, "Site header");
  await expect(shown).toBeVisible();
  await expect(shown).toContainText(reachLine("header"));
  await expect(
    shown.getByRole("button", { name: "Edit header" })
  ).toBeVisible();
  await expect(shown).toContainText(
    "To use a different header on this page, change it in Page settings."
  );
  // The heading's settings are gone.
  await expect(
    page.getByRole("complementary").getByRole("tab", { name: "Content" })
  ).toHaveCount(0);
  // No block's toolbar: nothing of the page is selected to move,
  // duplicate, delete or wrap.
  await expect(page.getByRole("toolbar", { name: /block/i })).toHaveCount(0);

  // Page settings, as a link, opens them.
  await shown.getByRole("button", { name: "Page settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");

  // A block chosen again takes the sidebar back.
  await clickBlock(page, FIRST);
  await expect(card(page, "Site header")).toHaveCount(0);
  await expect(header).toHaveAttribute("aria-pressed", "false");
});

test("selects the header and the footer from their rows in Layers", async ({
  page,
}) => {
  const { page: id } = await seed(page);
  await openBuilder(page, id);
  await openLayers(page);

  const headerRow = page.getByRole("button", {
    name: `Site header, ${SET} header & footer`,
  });
  await headerRow.click();
  await expect(headerRow).toHaveAttribute("aria-pressed", "true");
  await expect(await region(page, "header")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(card(page, "Site header")).toContainText(reachLine("header"));

  const footerRow = page.getByRole("button", {
    name: `Site footer, ${SET} header & footer`,
  });
  await footerRow.click();
  await expect(footerRow).toHaveAttribute("aria-pressed", "true");
  await expect(headerRow).toHaveAttribute("aria-pressed", "false");
  const footer = card(page, "Site footer");
  await expect(footer).toContainText(reachLine("footer"));
  await expect(
    footer.getByRole("button", { name: "Edit footer" })
  ).toBeVisible();
  await expect(footer).toContainText(
    "To use a different footer on this page, change it in Page settings."
  );
});

test("by keyboard: one Tab stop, Enter selects, Delete removes nothing and says why, Escape clears", async ({
  page,
}) => {
  const { page: id } = await seed(page);
  await openBuilder(page, id);
  const before = await (await canvasRoot(page))
    .locator("[data-nx-node]")
    .count();

  const header = await region(page, "header");
  await header.focus();
  await expect(header).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "Site header")).toBeVisible();

  await page.keyboard.press("Delete");
  await expect(announcer(page)).toHaveText(
    "The site header isn't part of this page. Change it in Page settings."
  );
  await page.keyboard.press("Backspace");
  expect(await (await canvasRoot(page)).locator("[data-nx-node]").count()).toBe(
    before
  );
  await expect(await block(page, FIRST)).toBeVisible();
  await expect(header).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(header).toHaveAttribute("aria-pressed", "false");
  await expect(card(page, "Site header")).toHaveCount(0);

  // The next Tab stop after the header is not inside it.
  await header.focus();
  await page.keyboard.press("Tab");
  const inHeader = await header.evaluate(node =>
    node.contains(node.ownerDocument.activeElement)
  );
  expect(inHeader).toBe(false);
});

test("draws the header's and footer's marks inside them, never over the page's first or last block", async ({
  page,
}) => {
  const { page: id } = await seed(page);
  await openBuilder(page, id);
  const header = await region(page, "header");
  const footer = await region(page, "footer");
  const first = await boxOf(page, FIRST);

  // No lock badge hangs past the region any more.
  await expect(header.locator(".nx-canvas-region__lock")).toHaveCount(0);

  await header.hover();
  const tag = header.locator(".nx-canvas-region__tag");
  await expect(tag).toBeVisible();
  const headerBox = await boxIn(header);
  expect(inside(await boxIn(tag), headerBox)).toBe(true);
  expect(overlaps(await boxIn(tag), first)).toBe(false);
  await header.click();
  await expect(tag).toHaveText("Site header");
  expect(inside(await boxIn(tag), headerBox)).toBe(true);
  expect(overlaps(await boxIn(tag), await boxOf(page, FIRST))).toBe(false);

  await footer.scrollIntoViewIfNeeded();
  await footer.click();
  const footerTag = footer.locator(".nx-canvas-region__tag");
  await expect(footerTag).toHaveText("Site footer");
  expect(inside(await boxIn(footerTag), await boxIn(footer))).toBe(true);
  expect(overlaps(await boxIn(footerTag), await boxOf(page, LAST))).toBe(false);
});

test("on an empty page, the footer's tag doesn't cover the header", async ({
  page,
}) => {
  const { empty } = await seed(page);
  await openBuilder(page, empty);
  const header = await region(page, "header");
  const footer = await region(page, "footer");
  await footer.click();
  const tag = footer.locator(".nx-canvas-region__tag");
  await expect(tag).toHaveText("Site footer");
  expect(overlaps(await boxIn(tag), await boxIn(header))).toBe(false);
  expect(inside(await boxIn(tag), await boxIn(footer))).toBe(true);
});

test("switches the outline once from the header to the block below as the pointer crosses the header's bottom edge", async ({
  page,
}) => {
  const { page: id } = await seed(page);
  await openBuilder(page, id);
  const header = await region(page, "header");
  const headerBox = await boxIn(header);
  const first = await boxOf(page, FIRST);
  const x = first.x + first.width / 2;
  const edge = headerBox.y + headerBox.height;
  const hovered = page.locator('.nx-canvas-mark[data-mark="hovered"]');
  const states: string[] = [];
  await page.mouse.move(x, edge - 14);
  for (let y = edge - 14; y <= edge + 14; y += 1) {
    await page.mouse.move(x, y);
    const onHeader = await header.evaluate(node => node.matches(":hover"));
    const onBlock = (await hovered.count()) > 0;
    states.push(onHeader ? "header" : onBlock ? "block" : "none");
  }
  // Read in order, the runs of the same state: the header's, then the
  // block's, with no return to the header and no flicker between them.
  const runs = states.filter((state, at) => state !== states[at - 1]);
  expect(runs.filter(state => state !== "none")).toEqual(["header", "block"]);
  expect(states[0]).toBe("header");
  expect(states.at(-1)).toBe("block");
});

test.describe("for an author who may not edit components", () => {
  let admin: APIRequestContext;
  let author: LimitedUser;

  test.beforeAll(async ({ browser, playwright }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL;
    if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
    admin = await playwright.request.newContext({
      baseURL,
      storageState: await fileAccount(baseURL, testInfo),
    });
    author = await signInAsLimitedUser(browser, admin, baseURL, [
      "read-pages",
      "update-pages",
      "read-components",
      "read-layouts",
    ]);
  });

  test.afterAll(async () => {
    await author?.context.close();
    await admin?.dispose();
  });

  test("shows the same card without Edit header, saying who can change it", async ({
    page,
  }) => {
    const { page: id } = await seed(page);
    const authorPage = await author.context.newPage();
    await openBuilder(authorPage, id);
    await (await region(authorPage, "header")).click();
    const shown = card(authorPage, "Site header");
    await expect(shown).toContainText(reachLine("header"));
    await expect(shown).toContainText(
      "You can't change the site header. Ask someone who can edit components."
    );
    await expect(
      shown.getByRole("button", { name: "Edit header" })
    ).toHaveCount(0);
    await expect(
      shown.getByRole("button", { name: "Page settings" })
    ).toBeVisible();
    await authorPage.close();
  });
});
