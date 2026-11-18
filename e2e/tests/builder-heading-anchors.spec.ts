/**
 * Every heading a published page draws has an id unique on the page, and an
 * author can leave any Heading out of a table of contents and is told where:
 *
 * - two Heading blocks and a Rich text heading reading "Notes" are drawn as
 *   `notes`, `notes-2` and `notes-3`, in page order;
 * - an author's own CSS id is never made for another heading;
 * - a heading in another script keeps its letters;
 * - "Leave out of table of contents" is in a Heading's Advanced settings,
 *   off; turned on and published, the heading keeps its id;
 * - a selected Table of contents says where that setting is.
 *
 * Seeded through the admin API as a published page, edited and published in
 * the real editor, and read back as a visitor reads it.
 */
import { expect, type Page } from "@playwright/test";

import { block, layerRow, openLayers } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

test.describe.configure({ timeout: 180_000 });

const ENTRIES = "/admin/api/collections/pages/entries";

const FIRST = "00000000-0000-4000-8000-0000000a0001";
const SECOND = "00000000-0000-4000-8000-0000000a0002";
const PASSAGE = "00000000-0000-4000-8000-0000000a0003";
const OWN_ID = "00000000-0000-4000-8000-0000000a0004";
const INTRO = "00000000-0000-4000-8000-0000000a0005";
const GERMAN = "00000000-0000-4000-8000-0000000a0006";
const JAPANESE = "00000000-0000-4000-8000-0000000a0007";
const LEFT_OUT = "00000000-0000-4000-8000-0000000a0008";
const CONTENTS = "00000000-0000-4000-8000-0000000a0009";

function heading(id: string, text: string, extra: object = {}): unknown {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text, level: "h2" },
    ...extra,
  };
}

/** A Rich text block whose passage is one H2. */
function passage(id: string, text: string): unknown {
  const words = {
    type: "text",
    text,
    format: 0,
    style: "",
    mode: "normal",
    detail: 0,
    version: 1,
  };
  const h2 = {
    type: "heading",
    tag: "h2",
    format: "",
    indent: 0,
    version: 1,
    direction: null,
    children: [words],
  };
  return {
    id,
    type: "core/rich-text",
    version: 1,
    props: {
      content: {
        root: {
          type: "root",
          format: "",
          indent: 0,
          version: 1,
          direction: null,
          children: [h2],
        },
      },
    },
  };
}

function nodes(): unknown[] {
  return [
    heading(FIRST, "Notes"),
    heading(SECOND, "Notes"),
    passage(PASSAGE, "Notes"),
    heading(OWN_ID, "About", { cssId: "intro" }),
    heading(INTRO, "Intro"),
    heading(GERMAN, "Über uns"),
    heading(JAPANESE, "日本語"),
    heading(LEFT_OUT, "Leave me out"),
    {
      id: CONTENTS,
      type: "core/table-of-contents",
      version: 1,
      props: { title: "On this page", depth: "h2-h3", collapsible: true },
    },
  ];
}

async function createPage(page: Page): Promise<{ id: string; slug: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `heading-anchors-${stamp}`;
  const created = await page.request.post(ENTRIES, {
    data: {
      title: `Heading anchors ${stamp}`,
      slug,
      status: "published",
      content: { formatVersion: 1, kind: "page", nodes: nodes() },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

/** Each heading element's id on the published page, in page order. */
async function publishedHeadingIds(
  page: Page,
  slug: string
): Promise<string[]> {
  const response = await page.request.get(`/${slug}`);
  expect(response.ok()).toBe(true);
  // The page's own headings: a Layout's header and footer, which another
  // spec may have made the site's default, are drawn in their own regions.
  const html = (await response.text()).replace(
    /<(header|footer) data-nextly-region="\1">[\s\S]*?<\/\1>/g,
    ""
  );
  return [...html.matchAll(/<h[1-6]\b([^>]*)>/g)].map(
    ([, attributes]) => /\sid="([^"]*)"/.exec(attributes ?? "")?.[1] ?? "(none)"
  );
}

/** Select a block from its row in Layers. */
async function select(page: Page, id: string): Promise<void> {
  await layerRow(page, id).locator(`[data-nx-layer="${id}"]`).first().click();
}

function entryWrite(page: Page, id: string) {
  return page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
}

test("every heading has a page-unique id, and a left-out heading keeps its id", async ({
  page,
}) => {
  const { id, slug } = await createPage(page);

  // As published: repeats numbered in page order across both kinds of
  // block, the author's `intro` never made for "Intro", any script kept.
  const expected = [
    "notes",
    "notes-2",
    "notes-3",
    "intro",
    "intro-2",
    "über-uns",
    "日本語",
    "leave-me-out",
  ];
  // Every heading element on the page, in order, none without an id. The
  // contents block lists nothing here (it reads no passage), so a visitor
  // gets none of it.
  expect(await publishedHeadingIds(page, slug)).toEqual(expected);

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(await block(page, LEFT_OUT)).toBeVisible({ timeout: 60_000 });
  await openLayers(page);

  // A selected Table of contents says where a heading is left out.
  await select(page, CONTENTS);
  await expect(
    page.getByText(
      "Any heading can be left out: Heading → Advanced → Leave out of table of contents",
      { exact: true }
    )
  ).toBeVisible();

  // The setting is in the Heading's Advanced settings, off.
  await select(page, LEFT_OUT);
  await page.getByRole("tab", { name: "Advanced" }).click();
  const leaveOut = page
    .getByRole("tabpanel", { name: "Advanced" })
    .getByRole("switch", { name: "Leave out of table of contents" });
  await expect(leaveOut).not.toBeChecked();
  await leaveOut.click();
  await expect(leaveOut).toBeChecked();

  const saved = entryWrite(page, id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  const publishedAgain = entryWrite(page, id);
  await page
    .getByRole("button", { name: "Publish changes", exact: true })
    .click();
  await publishedAgain;

  // Stored on the heading, and the heading still has its id.
  const stored = await page.request.get(`${ENTRIES}/${id}`);
  expect(JSON.stringify(await stored.json())).toContain('"tocExclude":true');
  expect(await publishedHeadingIds(page, slug)).toEqual(expected);
});
