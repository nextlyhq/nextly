/**
 * Page checks in the real editor: the count beside Publish, the grouped list
 * it opens, a press on an item taking the author to the setting that fixes
 * it, the bar that walks the list while they fix things, and nothing ever
 * holding back Save or Publish.
 *
 * Each test seeds its own draft page through the admin API, with pictures
 * that have an address and no alt text, so the image check has something to
 * find. The checks judge the draft on screen, so a fix shows before any save.
 *
 * @module tests/builder-page-checks.spec
 */
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type APIRequestContext,
  type Page,
  type Response,
} from "@playwright/test";

import { pressSave, selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const stamp = () =>
  `${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`;

/** A picture with an address, named as Layers names it, and no alt text. */
const picture = (id: string, name: string) => ({
  id,
  type: "core/image",
  version: 1,
  name,
  props: { src: `https://example.com/${id}.jpg`, loading: "lazy" },
});

/** A draft page holding a heading and the pictures, by id. */
async function draftPage(
  api: APIRequestContext,
  title: string,
  pictures: readonly { id: string; name: string }[]
): Promise<string> {
  const created = await api.post(ENTRIES, {
    data: {
      title,
      slug: title.toLowerCase().replaceAll(" ", "-"),
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "heading",
            type: "core/heading",
            version: 1,
            props: { text: title, level: "h1" },
          },
          ...pictures.map(each => picture(each.id, each.name)),
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

/** The page's status as stored. */
async function statusOf(api: APIRequestContext, id: string): Promise<unknown> {
  const read = await api.get(`${ENTRIES}/${id}?status=all`);
  expect(read.ok(), await read.text()).toBe(true);
  return ((await read.json()) as { status?: unknown }).status;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Whether `response` is the plugins' page checks answering for the page: the
 * route the editor asks once the page opens, whose findings are listed beside
 * the builder's own.
 */
function providedChecksAnswer(response: Response): boolean {
  return (
    new URL(response.url()).pathname.endsWith("/page-checks/provided") &&
    response.request().method() === "POST"
  );
}

const topBarEnd = (page: Page) => page.locator('[data-topbar="end"]');
const chip = (page: Page) =>
  topBarEnd(page).getByRole("button", { name: /^(\d+ checks?|Checks)\b/ });
const list = (page: Page) => page.getByRole("dialog", { name: "Page checks" });
const bar = (page: Page) =>
  page.getByRole("group", { name: "Fixing page checks" });
const item = (page: Page, block: string) =>
  list(page).getByRole("button", { name: `Image has no alt text: ${block}` });
const altText = (page: Page) =>
  page.locator(".nx-inspector").getByLabel("Alt text", { exact: true });

test("lists the page's checks by group, beside Publish", async ({ page }) => {
  await gotoAdmin(page, "/");
  const s = stamp();
  const id = await draftPage(page.request, `Checks list ${s}`, [
    { id: "team", name: "Team photo" },
    { id: "office", name: "Office photo" },
  ]);
  // The plugins' checks are asked once the page opens. Waited for, so the
  // count and the groups are read once every check has answered, not before
  // the plugins' have.
  const provided = page.waitForResponse(providedChecksAnswer);
  await openBuilder(page, id);
  expect((await provided).ok()).toBe(true);

  await expect(chip(page)).toHaveText("2 checks");
  // Beside Publish: the count comes just before Save and Publish.
  const publish = topBarEnd(page).getByRole("button", {
    name: /^Publish/,
  });
  expect(
    await chip(page).evaluate(
      (count, after) =>
        Boolean(
          count.compareDocumentPosition(after as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ),
      await publish.first().elementHandle()
    )
  ).toBe(true);

  await chip(page).click();
  await expect(list(page)).toBeVisible();
  // Search is a plugin's group, listed only where one offers checks: this
  // suite's server runs the SEO plugin, which does. It finds nothing on a
  // draft, so the count above is the two pictures alone.
  await expect(list(page).getByRole("heading", { level: 3 })).toHaveText([
    /^Accessibility/,
    /^Content and data/,
    /^Publishing/,
    /^Search/,
  ]);
  await expect(item(page, "Team photo")).toContainText(
    "Screen readers can’t describe the picture"
  );
  await expect(item(page, "Office photo")).toBeVisible();
  await expect(list(page)).toContainText(
    "Automatic checks catch common problems. They don’t replace an accessibility review."
  );

  const scan = await new AxeBuilder({ page })
    .include('[data-slot="popover-content"]')
    .withTags(AA_TAGS)
    .analyze();
  expect(scan.violations.map(v => `${v.id}: ${v.help}`)).toEqual([]);

  // Keyboard: the arrows walk the items, Escape closes back on the count.
  await item(page, "Team photo").focus();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "Office photo")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list(page)).toBeHidden();
  await expect(chip(page)).toBeFocused();
});

test("takes the author to the fix, and follows it as they type", async ({
  page,
}) => {
  await gotoAdmin(page, "/");
  const s = stamp();
  const id = await draftPage(page.request, `Checks fix ${s}`, [
    { id: "team", name: "Team photo" },
    { id: "office", name: "Office photo" },
  ]);
  await openBuilder(page, id);

  await chip(page).click();
  await item(page, "Team photo").click();
  // The block is selected and its Alt text has the cursor; the list gives
  // way to the bar, which leaves the inspector uncovered.
  await expect(list(page)).toBeHidden();
  await expect(bar(page)).toContainText("Check 1 of 2");
  await expect.poll(() => selection(page)).toEqual(["team"]);
  await expect(altText(page)).toBeFocused();

  await altText(page).fill("The team at launch");
  await page.keyboard.press("Enter");
  // Judged on the draft, unsaved: the item goes and the count drops.
  await expect(bar(page)).toContainText("Fixed · 1 to go");
  await expect(chip(page)).toHaveText("1 check");

  await bar(page).getByRole("button", { name: "Next check" }).click();
  await expect(bar(page)).toContainText("Check 1 of 1");
  await expect.poll(() => selection(page)).toEqual(["office"]);
  await expect(altText(page)).toBeFocused();

  await bar(page).getByRole("button", { name: "All checks" }).click();
  await expect(list(page)).toBeVisible();
  await expect(item(page, "Team photo")).toHaveCount(0);
  await expect(item(page, "Office photo")).toBeVisible();
  await page.keyboard.press("Escape");

  // Ticking Decorative fixes the last one: All clear, then the bar goes.
  await chip(page).click();
  await item(page, "Office photo").click();
  await page
    .locator(".nx-inspector")
    .getByRole("checkbox", { name: "Decorative, no alt text" })
    .check();
  await expect(bar(page)).toContainText("All clear");
  await expect(chip(page)).toHaveText("Checks");
  await expect(bar(page)).toBeHidden({ timeout: 10_000 });
});

test("never holds back Save or Publish", async ({ page }) => {
  await gotoAdmin(page, "/");
  const s = stamp();
  const id = await draftPage(page.request, `Checks publish ${s}`, [
    { id: "team", name: "Team photo" },
  ]);
  await openBuilder(page, id);
  await expect(chip(page)).toHaveText("1 check");

  // An edit that leaves the item open, then Save.
  await chip(page).click();
  await item(page, "Team photo").click();
  const inspector = page.locator(".nx-inspector");
  await inspector.getByRole("button", { name: "Caption", exact: true }).click();
  const caption = inspector.getByRole("textbox", { name: "Caption" });
  await caption.fill("Our team");
  await caption.press("Tab");
  await pressSave(page);
  await expect
    .poll(async () => {
      const nodes = await storedPageNodes(page.request, ENTRIES, id);
      return nodes.find(node => node.id === "team")?.props;
    })
    .toMatchObject({ caption: "Our team" });
  await expect(chip(page)).toHaveText("1 check");

  await topBarEnd(page)
    .getByRole("button", { name: /^Publish/ })
    .first()
    .click();
  await expect.poll(async () => statusOf(page.request, id)).toBe("published");
  await expect(chip(page)).toHaveText("1 check");
});
