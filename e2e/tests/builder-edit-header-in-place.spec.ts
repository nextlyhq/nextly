/**
 * Editing the site header or footer in place, right on the page: the three
 * ways in ("Edit header", a double-click, Enter on the selected header), the
 * bar with how many pages it reaches, the dim that changes nothing but
 * highlights Done, Layers and the inspector on the header's blocks, an Add
 * insert landing in the header, the top bar's "Save header" and "Publish
 * header", Done's question, two histories, the lock refusal, the leave
 * guard, a keyboard-only round, and the published page unchanged by an
 * unpublished edit.
 *
 * Seeded through the admin API: a header and a footer component, a published
 * set made the site's default, and a page of its own per test, so no test's
 * open editor holds another's lock. The site's previous default is put back
 * afterwards.
 *
 * @module tests/builder-edit-header-in-place.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  block,
  canvasRoot,
  clickBlock,
  openLayers,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { fileAccount, test } from "./support/test";

test.describe.configure({
  mode: "serial",
  lock: [LOCK.siteDefaultLayout],
  timeout: 150_000,
});

const API = "/admin/api";
const PLUGIN = `${API}/plugins/@nextlyhq/plugin-page-builder`;
const STAMP = `${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`;
const SET = `In place ${STAMP}`;
const HEADER_TEXT = `Harbour ${STAMP}`;
const FOOTER_TEXT = `Quay Ltd ${STAMP}`;
const BAR = /^Editing the site header · changes show on (at least )?\d+ pages?/;

interface Seeded {
  header: string;
  footer: string;
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

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

async function component(
  api: APIRequestContext,
  slug: string,
  area: "header" | "footer",
  nodes: readonly object[]
): Promise<string> {
  return idOf(
    await api.post(`${API}/collections/components/entries`, {
      data: {
        title: slug,
        slug: `${slug}-${STAMP}`,
        area,
        content: { formatVersion: 1, kind: "component", nodes },
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

async function seed(page: Page): Promise<Seeded> {
  if (seeded !== undefined) return seeded;
  await gotoAdmin(page, "/");
  const api = page.request;
  const choices = (await (
    await api.get(`${PLUGIN}/layouts/choices`)
  ).json()) as { meta: { defaultLayout: string | null } };
  const header = await component(api, "in-place-header", "header", [
    heading("brand", HEADER_TEXT),
    {
      id: "shop",
      type: "core/button",
      version: 1,
      props: { label: "Shop", href: "/shop" },
    },
  ]);
  const footer = await component(api, "in-place-footer", "footer", [
    heading("legal", FOOTER_TEXT),
  ]);
  const set = await idOf(
    await api.post(`${API}/collections/layouts/entries`, {
      data: {
        title: SET,
        slug: `in-place-${STAMP}`,
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
  seeded = { header, footer, previousDefault: choices.meta.defaultLayout };
  return seeded;
}

/** A page of its own, so no other test's open editor holds its lock. */
async function pageFor(page: Page, slug: string): Promise<string> {
  await seed(page);
  return idOf(
    await page.request.post(`${API}/collections/pages/entries`, {
      data: {
        title: `${slug} ${STAMP}`,
        slug: `${slug}-${STAMP}`,
        content: {
          formatVersion: 1,
          kind: "page",
          nodes: [heading("intro", "Welcome aboard")],
        },
        status: "published",
      },
    }),
    `creating ${slug}`
  );
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
  // The header as published now: an earlier test may have published a new
  // heading, so only its button's words are fixed.
  await expect(await region(page, "header")).toContainText("Shop", {
    timeout: 30_000,
  });
}

async function region(page: Page, area: "header" | "footer"): Promise<Locator> {
  return (await canvasRoot(page)).locator(`[data-nx-region="${area}"]`);
}

function bar(page: Page): Locator {
  return page.locator(".nx-region-bar");
}

function done(page: Page): Locator {
  return bar(page).getByRole("button", { name: "Done" });
}

function card(page: Page, name: "Site header" | "Site footer"): Locator {
  return page.getByRole("complementary").getByRole("region", { name });
}

function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** In through the card's "Edit header", the first way in. */
async function editFromCard(page: Page): Promise<void> {
  await (await region(page, "header")).click();
  await card(page, "Site header")
    .getByRole("button", { name: "Edit header" })
    .click();
  await expect(bar(page)).toHaveText(new RegExp(BAR.source + ".*Done$"));
}

/** The header's heading, changed through the inspector. */
async function renameBrand(page: Page, to: string): Promise<void> {
  await clickBlock(page, "brand");
  const text = page.getByRole("complementary").getByRole("textbox", {
    name: "Text",
  });
  await text.fill(to);
  await text.press("Tab");
  await expect(await block(page, "brand")).toContainText(to);
}

test("enters the header three ways, with the bar, the dim, Layers and the inspector on its blocks", async ({
  page,
}) => {
  await openBuilder(page, await pageFor(page, "three-ways"));

  // 1. "Edit header" on the card.
  await editFromCard(page);
  await expect(bar(page)).toContainText(
    "Editing the site header · changes show on"
  );
  await expect(page.locator(".nx-region-scrim__dim").first()).toBeVisible();
  await openLayers(page);
  await expect(page.getByText("Layers · Site header")).toBeVisible();
  await clickBlock(page, "brand");
  await expect(page.getByRole("complementary")).toContainText("in Site header");
  await done(page).click();
  await expect(bar(page)).toHaveCount(0);

  // 2. A double-click on the header.
  await (await region(page, "header")).dblclick();
  await expect(bar(page)).toContainText(BAR);
  await done(page).click();
  await expect(bar(page)).toHaveCount(0);

  // 3. Enter on the header while it is selected.
  const header = await region(page, "header");
  await header.focus();
  await page.keyboard.press("Enter");
  await expect(header).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(bar(page)).toContainText(BAR);
  await done(page).click();
});

test("the footer is edited the same way", async ({ page }) => {
  await openBuilder(page, await pageFor(page, "footer"));
  const footer = await region(page, "footer");
  await footer.scrollIntoViewIfNeeded();
  await footer.click();
  await card(page, "Site footer")
    .getByRole("button", { name: "Edit footer" })
    .click();
  await expect(bar(page)).toContainText(
    /^Editing the site footer · changes show on (at least )?\d+ pages?/
  );
  await openLayers(page);
  await expect(page.getByText("Layers · Site footer")).toBeVisible();
  await done(page).click();
});

test("a click on the dimmed page changes nothing but highlights Done, and an Add insert lands in the header", async ({
  page,
}) => {
  await openBuilder(page, await pageFor(page, "dim"));
  await editFromCard(page);
  // The page is drawn but not addressed while the header is edited: found by
  // its words.
  const root = await canvasRoot(page);
  const intro = root.getByText("Welcome aboard");
  await expect(intro).toBeVisible();

  // The dim covers the page: a press there pulses Done, and changes nothing.
  const box = await intro.boundingBox();
  if (box === null) throw new Error("[e2e] the page's block is not drawn");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(done(page)).toHaveAttribute("data-pulsing", "");
  await expect(bar(page)).toContainText(BAR);

  // Add inserts into the header, not the page.
  const headerBlocks = (await region(page, "header")).locator("[data-nx-node]");
  const before = await headerBlocks.count();
  await clickBlock(page, "shop");
  await page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Insert a block" })
  ).toBeVisible();
  await page.getByRole("option", { name: "Divider", exact: true }).click();
  await expect(headerBlocks).toHaveCount(before + 1);
  await done(page).click();
  await page.getByRole("button", { name: "Discard" }).click();
  // The page has its one block, as before.
  await expect(
    (await canvasRoot(page)).locator(".nx-pb-page [data-nx-node]")
  ).toHaveCount(1);
});

test("publishes the header from the top bar, and the page's own change stays unsaved and intact", async ({
  page,
}) => {
  await openBuilder(page, await pageFor(page, "publish"));
  // An unsaved change to the page first.
  await clickBlock(page, "intro");
  const text = page.getByRole("complementary").getByRole("textbox", {
    name: "Text",
  });
  await text.fill("Welcome, sailors");
  await text.press("Tab");

  await editFromCard(page);
  await expect(page.getByRole("button", { name: "Save header" })).toBeVisible();
  await renameBrand(page, `Harbour now ${STAMP}`);
  await page.getByRole("button", { name: "Publish header" }).click();
  const ask = page.getByRole("alertdialog", {
    name: /^Publish the header to (at least )?\d+ pages?\?$/,
  });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Publish header" }).click();
  await expect(toast(page, "The header is published.")).toBeVisible();

  // Done leaves at once: nothing is unsaved in the header now.
  await done(page).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(await block(page, "intro")).toContainText("Welcome, sailors");
  await expect(await region(page, "header")).toContainText(
    `Harbour now ${STAMP}`
  );
  // The page's Save still has the page's change to store.
  await expect(
    page.getByRole("button", { name: "Save", exact: true })
  ).toBeEnabled();
});

test("undo inside the header steps through its edits only, and after Done never reaches them", async ({
  page,
}) => {
  await openBuilder(page, await pageFor(page, "undo"));
  await clickBlock(page, "intro");
  const text = page.getByRole("complementary").getByRole("textbox", {
    name: "Text",
  });
  await text.fill("Page edit");
  await text.press("Tab");

  await editFromCard(page);
  const original = (await (await block(page, "brand")).textContent()) ?? "";
  await renameBrand(page, "Header one");
  await renameBrand(page, "Header two");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await undo.click();
  // A third undo has nothing left in the header's history.
  await expect(undo).toBeDisabled();
  await expect(await block(page, "brand")).toContainText(original);
  // The page, drawn but not addressed while the header is edited, keeps its
  // own edit.
  await expect((await canvasRoot(page)).getByText("Page edit")).toBeVisible();

  await done(page).click();
  await expect(bar(page)).toHaveCount(0);
  // The page's history is as it was: one undo takes back the page's edit.
  await undo.click();
  await expect(await block(page, "intro")).toContainText("Welcome aboard");
});

test("Done asks about unsaved changes: Keep editing stays, Save as draft leaves a draft not live", async ({
  page,
}) => {
  await openBuilder(page, await pageFor(page, "done"));
  await editFromCard(page);
  await renameBrand(page, `Draft brand ${STAMP}`);

  await done(page).click();
  const ask = page.getByRole("alertdialog", {
    name: "Publish your header changes?",
  });
  await expect(ask.getByRole("button")).toHaveText([
    "Keep editing",
    "Discard",
    "Save as draft",
    /^Publish to (at least )?\d+ pages?$/,
  ]);
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(bar(page)).toContainText(BAR);

  await done(page).click();
  await ask.getByRole("button", { name: "Save as draft" }).click();
  await expect(bar(page)).toHaveCount(0);
  // The published header is drawn again, and the card says a draft waits.
  await expect(await region(page, "header")).not.toContainText(
    `Draft brand ${STAMP}`
  );
  await (await region(page, "header")).click();
  await expect(card(page, "Site header")).toContainText(
    "Draft changes not live"
  );

  // In again: the bar says the version edited has unpublished changes.
  await card(page, "Site header")
    .getByRole("button", { name: "Edit header" })
    .click();
  await expect(bar(page)).toContainText("· Unpublished changes from ");
  await expect(await block(page, "brand")).toContainText(
    `Draft brand ${STAMP}`
  );

  // Discard throws the header's changes away and leaves.
  await renameBrand(page, "Thrown away");
  await done(page).click();
  await ask.getByRole("button", { name: "Discard" }).click();
  await expect(bar(page)).toHaveCount(0);
});

test("leaving the builder with unsaved header changes asks first", async ({
  page,
}) => {
  await openBuilder(page, await pageFor(page, "leave"));
  await editFromCard(page);
  await renameBrand(page, "Not saved");

  // The exit arrow goes through Done's question.
  await page
    .getByRole("button", { name: /^(Exit editor|Back to Pages)$/ })
    .click();
  await expect(
    page.getByRole("alertdialog", { name: "Publish your header changes?" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();

  // A reload asks too, as it does for the page's own work.
  let asked = false;
  page.once("dialog", dialog => {
    asked = dialog.type() === "beforeunload";
    void dialog.dismiss();
  });
  // Started from the page, so the browser runs the guard and the reload is
  // asked about; declined, the editor stays with the header open.
  await page.evaluate(() => window.location.reload()).catch(() => undefined);
  await expect.poll(() => asked).toBe(true);
  await expect(bar(page)).toContainText(BAR);
});

test("the published page is unchanged while a header edit is not published", async ({
  page,
}) => {
  const id = await pageFor(page, "visitor");
  await openBuilder(page, id);
  await editFromCard(page);
  await renameBrand(page, `Unpublished brand ${STAMP}`);
  await page.getByRole("button", { name: "Save header" }).click();
  await expect(toast(page, "The header is saved as a draft.")).toBeVisible();

  const served = await page.request.get(`/visitor-${STAMP}`);
  expect(served.ok(), `the page: ${served.status()}`).toBe(true);
  const html = await served.text();
  // The published header, and none of the draft.
  expect(html).toContain("Harbour");
  expect(html).not.toContain(`Unpublished brand ${STAMP}`);
});

test("by keyboard alone: select, edit, change the button, Done", async ({
  page,
}) => {
  await openBuilder(page, await pageFor(page, "keys"));
  const header = await region(page, "header");
  await header.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(bar(page)).toContainText(BAR);
  // Focus is on the header's first layer.
  await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
  await expect(
    page.getByRole("tree", { name: "Layers" }).locator(":focus")
  ).toHaveCount(1);
  // Down to the button, and into its label.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const label = page.getByRole("complementary").getByRole("textbox", {
    name: "Label",
    exact: true,
  });
  for (let tab = 0; tab < 40; tab += 1) {
    if (await label.evaluate(node => node === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(label).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Store");
  await page.keyboard.press("Tab");
  await expect(await block(page, "shop")).toContainText("Store");

  // Escape leaves the innermost first: the selection, then the header.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const ask = page.getByRole("alertdialog", {
    name: "Publish your header changes?",
  });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(bar(page)).toHaveCount(0);
  await expect(header).toBeFocused();
});

test.describe("with a second session or fewer rights", () => {
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
      "update-components",
      "read-layouts",
    ]);
  });

  test.afterAll(async () => {
    await author?.context.close();
    await admin?.dispose();
  });

  test("does not enter while someone else has the header open, and says who", async ({
    page,
  }) => {
    const { header } = await seed(page);
    const id = await pageFor(page, "locked");
    // The author opens the header component in its own editor, which holds
    // its lock.
    const other = await author.context.newPage();
    await gotoAdmin(other, `/collections/components/${header}`);
    await expect(other.getByRole("main")).toBeVisible({ timeout: 30_000 });

    await openBuilder(page, id);
    await (await region(page, "header")).click();
    await card(page, "Site header")
      .getByRole("button", { name: "Edit header" })
      .click();
    await expect(
      toast(page, /is editing this header\. Try again when they're done\.$/)
    ).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await other.close();
  });

  test("without the right to publish components, Done offers no publish", async ({
    page,
  }) => {
    const id = await pageFor(page, "no-publish");
    const authorPage = await author.context.newPage();
    await openBuilder(authorPage, id);
    await editFromCard(authorPage);
    await expect(
      authorPage.getByRole("button", { name: "Publish header" })
    ).toHaveCount(0);
    await renameBrand(authorPage, "Mine");
    await done(authorPage).click();
    const ask = authorPage.getByRole("alertdialog", {
      name: "Publish your header changes?",
    });
    await expect(ask.getByRole("button")).toHaveText([
      "Keep editing",
      "Discard",
      "Save as draft",
    ]);
    await ask.getByRole("button", { name: "Discard" }).click();
    await authorPage.close();
  });
});
