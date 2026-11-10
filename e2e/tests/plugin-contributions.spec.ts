/**
 * A plugin extends a page, in a browser: the playground's contributions
 * fixture adds a block, a tab and a side panel section to a Post's edit page,
 * and a column, a row action and a bulk action to Posts' list. Each draws its
 * own component, in light and in dark, readable and axe-clean, and never the
 * place's fallback. A block behind a permission reaches only a reader who
 * holds it, decided by the server: the workspace answer leaves it out. A
 * replacement takes the built-in editor's place on the one collection it is
 * scoped to, and on no other. The page keeps its own parts around them.
 *
 * Each fixture component draws a region named for it, whose text says it is
 * the fixture, so a component that failed to load fails here instead of
 * passing on an empty slot.
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { contrastRatio, gotoAdmin, toRgb, type Theme } from "./support/admin";
import { expectNoAxeViolations } from "./support/axe";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { LOCK } from "./support/locks";
import { createEntry, expectOk } from "./support/runtime-collection";
import { test } from "./support/test";

// Creates roles for its two viewers; the posts it reads are its own.
test.describe.configure({ mode: "serial", lock: [LOCK.usersRoles] });

// Unique to this attempt: a retry runs `beforeAll` again.
const RUN = Date.now().toString(36);
const DRAFT_TITLE = `A fixture draft ${RUN}`;
const PUBLISHED_TITLE = `A fixture live post ${RUN}`;
const STORY_TITLE = `A fixture story ${RUN}`;

let admin: APIRequestContext;
/** Holds `update-posts`: sent the gated block. */
let viewerA: LimitedUser;
/** Reads posts alone: not sent the gated block. */
let viewerB: LimitedUser;
let draftId: string;
let publishedId: string;
let storyId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });
  // The replacement's collection exists only on a server started with the
  // e2e fixtures; without it this file fails here, loudly, instead of
  // passing E4 on a page that is not there.
  await expectOk(
    await admin.get(
      "/admin/api/collections/contribution-stories/entries?limit=1"
    ),
    "the e2e-only contribution-stories collection (NEXTLY_E2E_STYLE_FIXTURE=1)"
  );
  draftId = await createEntry(admin, "posts", {
    title: DRAFT_TITLE,
    slug: `fixture-draft-${RUN}`,
  });
  publishedId = await createEntry(admin, "posts", {
    title: PUBLISHED_TITLE,
    slug: `fixture-live-${RUN}`,
    status: "published",
  });
  storyId = await createEntry(admin, "contribution-stories", {
    title: STORY_TITLE,
    summary: "A story the fixture's replacement draws over.",
  });
  viewerA = await signInAsLimitedUser(browser, admin, baseURL, [
    "read-posts",
    "update-posts",
  ]);
  viewerB = await signInAsLimitedUser(browser, admin, baseURL, ["read-posts"]);
});

test.afterAll(async () => {
  await viewerA?.context.close();
  await viewerB?.context.close();
  for (const [collection, id] of [
    ["posts", draftId],
    ["posts", publishedId],
    ["contribution-stories", storyId],
  ] as const) {
    if (id)
      await admin?.delete(`/admin/api/collections/${collection}/entries/${id}`);
  }
  await admin?.dispose();
});

/** A fixture region, by the name its component gives it. */
const region = (page: Page | Locator, name: string) =>
  page.getByRole("region", { name, exact: true });

/** Text against the nearest opaque background behind it, as WCAG measures it. */
async function expectReadable(page: Page, target: Locator): Promise<void> {
  const { color, background } = await target.evaluate(element => {
    const style = getComputedStyle(element);
    let node: Element | null = element;
    let background = "rgb(255, 255, 255)";
    while (node) {
      const fill = getComputedStyle(node).backgroundColor;
      const transparent =
        fill === "transparent" || /rgba?\([^)]*,\s*0\)$/.test(fill);
      if (!transparent) {
        background = fill;
        break;
      }
      node = node.parentElement;
    }
    return { color: style.color, background };
  });
  const ratio = contrastRatio(
    await toRgb(page, color),
    await toRgb(page, background)
  );
  expect(ratio, `contrast of ${color} on ${background}`).toBeGreaterThanOrEqual(
    4.5
  );
}

/** The side panel's sections, by the titles they are drawn under, in order. */
async function panelSections(page: Page): Promise<string[]> {
  return page
    .locator("[data-panel-section]")
    .evaluateAll(nodes =>
      nodes.map(node => node.getAttribute("data-panel-section") ?? "")
    );
}

/**
 * The row of Posts' list holding `title`. By its element rather than its role:
 * a row that opens its entry is exposed as a button, not as a row.
 */
const rowOf = (page: Page, title: string) =>
  page
    .getByRole("table", { name: "Entries table" })
    .locator("tbody tr")
    .filter({ hasText: title });

/** The labels in `title`'s row menu, read and then closed. */
async function rowMenu(page: Page, title: string): Promise<string[]> {
  await rowOf(page, title).getByRole("button", { name: "Row actions" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const labels = (await menu.getByRole("menuitem").allTextContents()).map(
    label => label.trim()
  );
  await page.keyboard.press("Escape");
  return labels;
}

for (const theme of ["light", "dark"] as const satisfies readonly Theme[]) {
  test(`a plugin's block, tab and side panel section draw on a post's edit page (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, `/collections/posts/${draftId}`, theme);

    const block = region(page, "Fixture block");
    const section = region(page, "Fixture section");
    await expect(block).toContainText("Fixture block, drawn by");
    await expect(section).toContainText("Fixture section, drawn by");

    // E5: the page keeps its own parts around them.
    await expect(page.getByTestId("document-bar")).toBeVisible();
    const sections = await panelSections(page);
    // The panel's own sections in their own order, and the fixture's
    // straight after Details, where it was placed.
    const own = ["Status", "Publishing", "Language", "Details"];
    const drawnOwn = sections.filter(name => own.includes(name));
    expect(drawnOwn, sections.join(", ")).toEqual(
      own.filter(name => drawnOwn.includes(name))
    );
    expect(drawnOwn).toContain("Details");
    expect(sections[sections.indexOf("Details") + 1]).toBe("Fixture");
    const tabs = page.getByRole("tablist");
    const tabNames = (await tabs.getByRole("tab").allTextContents()).map(name =>
      name.trim()
    );
    expect(tabNames.at(-1)).toBe("Fixture");
    expect(tabNames.length).toBeGreaterThan(1);

    await tabs.getByRole("tab", { name: "Fixture" }).click();
    const tab = region(page, "Fixture tab");
    await expect(tab).toContainText("Fixture tab, drawn by");

    for (const part of [block, section, tab]) await expectReadable(page, part);
    await expectNoAxeViolations(page, { include: "[aria-label^='Fixture']" });
  });

  test(`a plugin's column and row action draw on the posts list (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdmin(page, "/collections/posts", theme);

    const table = page.getByRole("table", { name: "Entries table" });
    await expect(
      table.getByRole("columnheader", { name: "Fixture", exact: true })
    ).toBeVisible();
    // The cell reads its own row: the draft's cell shows the draft's title.
    const cell = region(rowOf(page, DRAFT_TITLE), "Fixture cell");
    await expect(cell).toHaveText(DRAFT_TITLE);
    await expectReadable(page, cell);

    // The row action is offered where its rule holds, and only there.
    expect(await rowMenu(page, DRAFT_TITLE)).toContain("Fixture: inspect");
    expect(await rowMenu(page, PUBLISHED_TITLE)).not.toContain(
      "Fixture: inspect"
    );

    await expectNoAxeViolations(page, {
      include: "[aria-label='Fixture cell']",
    });
  });
}

test("the row action opens its component with the post it was chosen on", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/collections/posts");

  await rowOf(page, DRAFT_TITLE)
    .getByRole("button", { name: "Row actions" })
    .click();
  await page.getByRole("menuitem", { name: "Fixture: inspect" }).click();

  const dialog = page.getByRole("dialog", { name: "Fixture: inspect" });
  await expect(region(dialog, "Fixture action")).toHaveText(
    new RegExp(`^Fixture action on posts/${draftId}\\s*Close$`)
  );
  await region(dialog, "Fixture action")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(rowOf(page, DRAFT_TITLE)).toBeVisible();
});

test("a block behind a permission is drawn for a viewer who holds it and not for one who does not", async ({
  page,
}) => {
  // The super-admin is sent both.
  await gotoAdmin(page, `/collections/posts/${draftId}`);
  await expect(region(page, "Fixture block")).toBeVisible();
  await expect(region(page, "Fixture gated block")).toBeVisible();

  for (const [viewer, sent] of [
    [viewerA, true],
    [viewerB, false],
  ] as const) {
    const viewerPage = await viewer.context.newPage();
    // What the server sent this reader: the evidence is its pruning, not an
    // element the browser hid.
    const workspace = viewerPage.waitForResponse(response =>
      response.url().includes("/admin/api/admin-meta/workspace")
    );
    await gotoAdmin(viewerPage, `/collections/posts/${draftId}`);
    const contributions = JSON.stringify(
      ((await (await workspace).json()) as { contributions?: unknown })
        .contributions ?? {}
    );
    expect(contributions.includes("contributions-fixture.gated-block")).toBe(
      sent
    );

    // Read after the slot drew: the ungated block is the sign it did.
    await expect(region(viewerPage, "Fixture block")).toBeVisible();
    if (sent) {
      await expect(region(viewerPage, "Fixture gated block")).toBeVisible();
    } else {
      await expect(region(viewerPage, "Fixture gated block")).toHaveCount(0);
    }
    await viewerPage.close();
  }
});

test("a plugin's replacement takes the built-in editor's place on its collection's edit page, and leaves every other collection's alone", async ({
  page,
}) => {
  await gotoAdmin(page, `/collections/contribution-stories/${storyId}`);
  await expect(region(page, "Fixture replacement")).toContainText(
    `Fixture replacement of the editor, for ${storyId}`
  );
  // Instead of the editor, not beside it: none of the story's fields.
  await expect(page.getByLabel("Summary", { exact: true })).toHaveCount(0);

  await gotoAdmin(page, `/collections/posts/${draftId}`);
  await expect(page.getByLabel("Excerpt", { exact: true })).toBeVisible();
  await expect(region(page, "Fixture replacement")).toHaveCount(0);
});
