/**
 * Adding several documents from inside a release, in a real browser: the
 * picker lists documents across collections, adds the selection in one
 * action, and, for documents going live, offers the documents they link to
 * that are not published, before it closes.
 *
 * Each test writes documents and releases of its own, named with a stamp, and
 * cancels the releases it made. The linked-documents tests share one
 * collection, made once for them through the Schema Builder's own call, which
 * a production build refuses, so this runs on the dev server (`DEV_SPECS` in
 * `playwright.config.ts`).
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { cancel, membersOf, ok, post } from "./support/releases-api";
import { LOCK } from "./support/locks";
import { removeMigrationsOf } from "./support/runtime-collection";
import { test } from "./support/test";

const API = "/admin/api";

/** A stamp of this test's own. */
const stamped = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** A draft release with nothing in it yet. */
async function emptyRelease(page: Page, title: string): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/releases`, { data: { title } })
  );
  return item.id;
}

/** An author, created as a draft: never published. */
async function author(page: Page, title: string): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/authors/entries`, {
      data: { title },
    })
  );
  return item.id;
}

/**
 * A collection with a Draft/Published lifecycle and a link to an author, made
 * at runtime as the Schema Builder makes one.
 */
async function piecesLinkingAuthors(
  api: APIRequestContext,
  slug: string
): Promise<void> {
  await ok(
    await api.post(`${API}/collections`, {
      data: {
        name: slug,
        labels: { singular: "Piece", plural: "Pieces" },
        status: true,
        fields: [
          {
            name: "writer",
            type: "relationship",
            options: { relationType: "manyToOne", target: "authors" },
          },
        ],
      },
    })
  );
}

/** An entry of the pieces collection `slug`, linking `authorId`. */
async function pieceLinking(
  page: Page,
  slug: string,
  title: string,
  authorId: string
): Promise<string> {
  const { item } = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/${slug}/entries`, {
      data: { title, writer: authorId },
    })
  );
  return item.id;
}

/** Opens Add documents on a release's page, narrowed to this test's stamp. */
async function openPicker(page: Page, releaseId: string, stamp: string) {
  await gotoAdmin(page, `/releases/${releaseId}`);
  await page.getByRole("button", { name: "Add documents" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Find a document").fill(stamp);
  return dialog;
}

test.beforeEach(async ({ page }) => {
  // Each test writes documents and releases of its own, and the first reads of the dev server
  // compile on demand: more than the default allows.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("adds three documents from two collections in one action", async ({
  page,
}) => {
  const stamp = stamped();
  const first = await post(page, `${stamp}-a`);
  const second = await post(page, `${stamp}-b`);
  const writer = await author(page, `Release e2e author ${stamp}`);
  const releaseId = await emptyRelease(page, `Batch ${stamp}`);
  try {
    const dialog = await openPicker(page, releaseId, stamp);
    await dialog
      .getByRole("checkbox", { name: `Release e2e ${stamp}-a` })
      .click();
    await dialog
      .getByRole("checkbox", { name: `Release e2e ${stamp}-b` })
      .click();
    await dialog
      .getByRole("checkbox", { name: `Release e2e author ${stamp}` })
      .click();

    const answered = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith(
        `/releases/${releaseId}/members/batch`
      )
    );
    await dialog.getByRole("button", { name: "Add 3 documents" }).click();
    const response = await answered;
    expect(response.ok(), await response.text()).toBe(true);
    await expect(dialog).toHaveCount(0);

    const members = await membersOf(page, releaseId);
    expect(members.map(member => member.entryId).sort()).toEqual(
      [first, second, writer].sort()
    );
    expect(members.every(member => member.action === "publish")).toBe(true);
  } finally {
    await cancel(page, releaseId).catch(() => undefined);
  }
});

test.describe("the linked documents offered next", () => {
  // The describe makes a collection at runtime, which writes migration files and the schema.
  test.describe.configure({ lock: [LOCK.schema] });

  // One collection for the describe, not one per test: making one, and
  // removing its migrations after, each write files the dev server reloads
  // on, and a page opened during those reloads waits on them. Each test then
  // writes only entries of its own.
  const slug = `pieces-${stamped().replace(/[^a-z0-9]/g, "")}`;

  test.beforeAll(async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({
      baseURL,
      storageState: STORAGE_STATE,
    });
    try {
      await piecesLinkingAuthors(api, slug);
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    await removeMigrationsOf(slug);
  });

  test("offers an unpublished author of a piece going live, and adds it", async ({
    page,
  }) => {
    const stamp = stamped();
    const writer = await author(page, `Linked author ${stamp}`);
    const piece = await pieceLinking(page, slug, `Piece ${stamp}`, writer);
    const releaseId = await emptyRelease(page, `Linked ${stamp}`);
    try {
      const dialog = await openPicker(page, releaseId, `Piece ${stamp}`);
      await dialog.getByRole("checkbox", { name: `Piece ${stamp}` }).click();
      await dialog.getByRole("button", { name: "Add 1 document" }).click();

      await expect(
        dialog.getByRole("heading", {
          name: "Linked documents that won’t be live",
        })
      ).toBeVisible();
      await expect(dialog).toContainText(`Linked author ${stamp}`);
      await dialog.getByRole("button", { name: "Add 1 document" }).click();
      await expect(dialog).toHaveCount(0);

      const members = await membersOf(page, releaseId);
      expect(members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entryId: piece, action: "publish" }),
          expect.objectContaining({ entryId: writer, action: "publish" }),
        ])
      );
      expect(members).toHaveLength(2);
    } finally {
      await cancel(page, releaseId).catch(() => undefined);
    }
  });

  test("adds nothing more on Not now", async ({ page }) => {
    const stamp = stamped();
    const writer = await author(page, `Linked author ${stamp}`);
    const piece = await pieceLinking(page, slug, `Piece ${stamp}`, writer);
    const releaseId = await emptyRelease(page, `Not now ${stamp}`);
    try {
      const dialog = await openPicker(page, releaseId, `Piece ${stamp}`);
      await dialog.getByRole("checkbox", { name: `Piece ${stamp}` }).click();
      await dialog.getByRole("button", { name: "Add 1 document" }).click();
      await dialog.getByRole("button", { name: "Not now" }).click();
      await expect(dialog).toHaveCount(0);

      expect(await membersOf(page, releaseId)).toEqual([
        expect.objectContaining({ entryId: piece, action: "publish" }),
      ]);
    } finally {
      await cancel(page, releaseId).catch(() => undefined);
    }
  });

  test("offers nothing for a piece added to come down", async ({ page }) => {
    const stamp = stamped();
    const writer = await author(page, `Linked author ${stamp}`);
    const piece = await pieceLinking(page, slug, `Piece ${stamp}`, writer);
    const releaseId = await emptyRelease(page, `Down ${stamp}`);
    try {
      const dialog = await openPicker(page, releaseId, `Piece ${stamp}`);
      await dialog.getByRole("radio", { name: "Comes down" }).click();
      await dialog.getByRole("checkbox", { name: `Piece ${stamp}` }).click();
      await dialog.getByRole("button", { name: "Add 1 document" }).click();
      await expect(dialog).toHaveCount(0);

      expect(await membersOf(page, releaseId)).toEqual([
        expect.objectContaining({ entryId: piece, action: "unpublish" }),
      ]);
    } finally {
      await cancel(page, releaseId).catch(() => undefined);
    }
  });
});
