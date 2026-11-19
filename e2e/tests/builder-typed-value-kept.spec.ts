/**
 * A value still being typed in the block settings panel is kept by every
 * action that reads the page, with focus still in the field:
 *
 * 1. Save from the keyboard (`mod` is Control in the suite's browser) saves
 *    what the field shows: a Form field's label, which the field writes when
 *    it is left, and a Heading's text, which it writes as it is typed. Focus
 *    stays in the field.
 * 2. On a published page, the first letter typed shows the page as having
 *    unsaved work, on Save, with focus still in the field; Publish then
 *    publishes what the field shows.
 * 3. Preview previews what the field shows.
 * 4. Opening another page from the Pages panel asks about the unsaved work,
 *    and Keep Editing comes back to the value as typed.
 *
 * @module builder-typed-value-kept.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { block, clickBlock, selection } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-00000000c731";
const FORM = "00000000-0000-4000-8000-00000000c732";

// The Form first: a selected block's toolbar and the Form's own notice sit
// above it, where they would cover a Heading drawn there.
const NODES = [
  {
    id: FORM,
    type: "core/form",
    version: 2,
    props: {
      method: "post",
      submitText: "Send",
      fields: [{ label: "Name", name: "name", type: "text", required: true }],
    },
  },
  {
    id: HEADING,
    type: "core/heading",
    version: 1,
    props: { text: "Typed heading", level: "h2" },
  },
];

/**
 * A page of its own holding the Heading and the Form, with its address and
 * its title, which is this attempt's alone: a page an earlier attempt left
 * behind has another.
 */
async function createPage(
  request: APIRequestContext,
  title: string,
  status: "draft" | "published"
): Promise<{ id: string; slug: string; title: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `typed-kept-${stamp}`;
  const stamped = `${title} ${stamp}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: stamped,
      slug,
      status,
      content: { formatVersion: 1, kind: "page", nodes: NODES },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  const body = (await created.json()) as { item: { id: string } };
  return { id: body.item.id, slug, title: stamped };
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(await block(page, HEADING)).toBeVisible({ timeout: 60_000 });
}

const bar = (page: Page): Locator => page.locator('[data-topbar="end"]');
const saveButton = (page: Page): Locator =>
  bar(page).locator('[data-action="save"]');
const inspector = (page: Page): Locator => page.getByTestId("inspector");

async function select(page: Page, id: string): Promise<void> {
  await clickBlock(page, id);
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** Type `words` at the end of the Form's first field's label, staying in it. */
async function typeInLabel(page: Page, words: string): Promise<Locator> {
  await select(page, FORM);
  await inspector(page)
    .getByRole("list", { name: "Fields" })
    .getByRole("button", { name: /^Name/ })
    .click();
  const label = inspector(page).getByLabel("Label", { exact: true });
  await label.click();
  await label.press("End");
  await label.pressSequentially(words, { delay: 40 });
  await expect(label).toBeFocused();
  return label;
}

/** Type `words` at the end of the Heading's text, staying in the field. */
async function typeInHeading(page: Page, words: string): Promise<Locator> {
  await select(page, HEADING);
  const text = inspector(page).getByRole("textbox", {
    name: "Text",
    exact: true,
  });
  await text.click();
  await text.press("End");
  await text.pressSequentially(words, { delay: 40 });
  await expect(text).toBeFocused();
  return text;
}

/** The write of this page, and not the other requests under its path. */
function pageWrite(page: Page, id: string) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok(),
    { timeout: 30_000 }
  );
}

/** The Heading's text and the Form's first label, as `nodes` hold them. */
function wordsOf(nodes: readonly Record<string, unknown>[]): {
  heading: unknown;
  label: unknown;
} {
  const props = (id: string) =>
    (nodes.find(node => node.id === id)?.props ?? {}) as Record<
      string,
      unknown
    >;
  const fields = props(FORM).fields as { label?: unknown }[] | undefined;
  return { heading: props(HEADING).text, label: fields?.[0]?.label };
}

/** What the page holds as saved, its working draft laid over it. */
async function savedWords(page: Page, id: string) {
  return wordsOf(await storedPageNodes(page.request, ENTRIES, id));
}

/** What the published row holds, without the working draft. */
async function publishedWords(page: Page, id: string) {
  const response = await page.request.get(
    `${ENTRIES}/${encodeURIComponent(id)}`
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as {
    content?: { nodes?: Record<string, unknown>[] };
  };
  return wordsOf(body.content?.nodes ?? []);
}

test.describe("a value still being typed in the panel", () => {
  test.describe.configure({ timeout: 240_000 });

  test("Save from the keyboard saves what the field shows, and focus stays in it", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, "Typed save", "draft");
    await openBuilder(page, id);

    // A label, which its field writes when it is left.
    const label = await typeInLabel(page, " here");
    let written = pageWrite(page, id);
    await page.keyboard.press("Control+s");
    await written;
    await expect(label).toBeFocused();
    await expect(label).toHaveValue("Name here");
    expect((await savedWords(page, id)).label).toBe("Name here");

    // A Heading's text, which its field writes as it is typed.
    const text = await typeInHeading(page, " kept");
    written = pageWrite(page, id);
    await page.keyboard.press("Control+s");
    await written;
    await expect(text).toBeFocused();
    expect(await savedWords(page, id)).toEqual({
      heading: "Typed heading kept",
      label: "Name here",
    });
  });

  for (const field of ["label", "heading"] as const) {
    test(`one letter in the ${field} field of a published page shows unsaved work at once`, async ({
      page,
    }) => {
      const { id } = await createPage(
        page.request,
        "Typed status",
        "published"
      );
      await openBuilder(page, id);
      await expect(saveButton(page)).toHaveText("Saved");

      const typed =
        field === "label"
          ? await typeInLabel(page, "s")
          : await typeInHeading(page, "s");
      await expect(saveButton(page)).toHaveText("Save");
      await expect(typed).toBeFocused();
      const bar = page.locator("[data-topbar]");
      await expect(bar.getByText("Unsaved changes")).toHaveCount(0);
      await expect(bar.getByText("Modified")).toHaveCount(0);

      // Publish, pressed from the field, publishes what it shows.
      const published = pageWrite(page, id);
      await page.locator('[data-topbar="end"] [data-action="publish"]').click();
      await published;
      const words = await publishedWords(page, id);
      expect(field === "label" ? words.label : words.heading).toBe(
        field === "label" ? "Names" : "Typed headings"
      );
    });
  }

  test("Preview from the field previews what it shows", async ({
    page,
    context,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const site = await page.request.patch("/admin/api/general-settings", {
      data: { siteUrl: baseURL },
    });
    expect(site.ok(), `saving the site URL: ${site.status()}`).toBe(true);
    const { id, slug } = await createPage(
      page.request,
      "Typed preview",
      "published"
    );
    await openBuilder(page, id);

    await typeInLabel(page, " previewed");
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      bar(page).getByRole("button", { name: "Preview", exact: true }).click(),
    ]);
    await expect(tab.getByText("Name previewed")).toBeVisible({
      timeout: 90_000,
    });
    expect(new URL(tab.url()).pathname).toBe(`/${slug}`);
    await tab.close();
  });

  test("opening another page asks first, and Keep Editing keeps the value as typed", async ({
    page,
  }) => {
    const { id } = await createPage(page.request, "Typed switch", "draft");
    const other = await createPage(page.request, "Typed other", "draft");
    await openBuilder(page, id);

    await typeInLabel(page, " switched");
    const panelButton = page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Pages" });
    if ((await panelButton.getAttribute("aria-pressed")) !== "true") {
      await panelButton.click();
    }
    const pages = page.getByRole("region", { name: "Pages" }).first();
    await pages
      .getByRole("textbox", { name: "Search pages" })
      .fill(other.title);
    await pages.getByRole("button", { name: other.title, exact: true }).click();

    const question = page.getByRole("alertdialog", { name: "Unsaved Changes" });
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Keep Editing" }).click();
    await expect(question).toBeHidden();
    await expect(page).toHaveURL(
      new RegExp(`/collections/pages/${id}/builder\\?field=content$`)
    );
    expect(page.url()).not.toContain(other.id);
    await expect(await block(page, FORM)).toContainText("Name switched");
  });
});
