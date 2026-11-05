/**
 * Two people and one document: a save made from a copy someone changed since
 * is refused, and the editor shows it as a conflict.
 *
 * The editor sends the version its copy started from with every save. When a
 * colleague saved in between, the save is refused, and the editor says who
 * changed the document and when, keeps the unsaved edits on screen, and offers
 * to load the current version (keeping the edits as a recovery point) or to
 * save anyway after a confirmation that says whose changes it replaces. Where
 * the document keeps history, it links the change that made the save stale.
 *
 * The colleague writes through the API while the editor holds the document:
 * a held claim gates no write, and an API write is the one way a colleague's
 * change reaches a document someone else has open.
 *
 * @module tests/conflict-two-editors
 */
import {
  expect,
  request,
  type APIRequestContext,
  type Page,
  type Request,
} from "@playwright/test";

import {
  createSignedInUser,
  superAdminRoleId,
  uniqueTag,
} from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { pressSave } from "./canvas/editor-driver";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";
import { claimedBy, secondEditor, SECOND_EDITOR } from "./support/two-editors";

// A colleague's account each test; the Single and the homepage are claimed by
// whoever opens them, so each file holding them frees them first.
test.describe.configure({
  lock: [LOCK.usersRoles, LOCK.siteSettings, LOCK.homepage],
});

const POSTS = "/admin/api/collections/posts/entries";
const SITE_SETTINGS = "/admin/api/singles/site-settings";
const HOMEPAGE = "/admin/api/singles/homepage";
const CONFLICT = /changed since you started editing/i;

/** A colleague signed in on their own, writing through the API. */
async function colleague(
  admin: APIRequestContext,
  baseURL: string | undefined
): Promise<{ api: APIRequestContext; name: string }> {
  if (!baseURL) throw new Error("The suite configures no baseURL.");
  const tag = uniqueTag();
  const name = `Colleague ${tag}`;
  const { storageState } = await createSignedInUser(admin, baseURL, {
    email: `colleague-${tag}@nextly.local`,
    name,
    roleIds: [await superAdminRoleId(admin)],
  });
  return {
    api: await request.newContext({ baseURL, storageState }),
    name,
  };
}

const excerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

/** A post of its own, open in the editor with its claim landed. */
async function openPost(page: Page): Promise<{ id: string; stored: string }> {
  const tag = uniqueTag();
  const stored = `Stored excerpt ${tag}`;
  const id = await createEntry(page.request, "posts", {
    title: `Conflict ${tag}`,
    slug: `conflict-${tag}`,
    excerpt: stored,
  });
  await gotoAdmin(page, `/collections/posts/${id}`);
  await expect(excerpt(page)).toHaveValue(stored, { timeout: 30_000 });
  await expect(excerpt(page)).toBeEditable();
  await claimedBy(page.request, {
    scopeKind: "collection",
    slug: "posts",
    entryId: id,
  });
  return { id, stored };
}

/** The editor's edit, a colleague's save after it, then the editor's save. */
async function staleSave(
  page: Page,
  id: string,
  writer: APIRequestContext,
  theirs: string
): Promise<string> {
  const mine = `My excerpt ${uniqueTag()}`;
  await excerpt(page).fill(mine);
  const written = await writer.patch(`${POSTS}/${id}`, {
    data: { excerpt: theirs },
  });
  expect(written.ok(), await written.text()).toBe(true);
  await page
    .getByRole("button", { name: /^Save( draft)?$/ })
    .first()
    .click();
  return mine;
}

const conflict = (page: Page) =>
  page.getByRole("alertdialog", { name: CONFLICT });

/** The post's excerpt as stored, read through the API. */
async function storedExcerpt(page: Page, id: string): Promise<unknown> {
  // Drafts included: these posts are never published.
  const read = await page.request.get(`${POSTS}/${id}?status=all`);
  expect(read.ok(), await read.text()).toBe(true);
  const body = (await read.json()) as {
    excerpt?: unknown;
    item?: { excerpt?: unknown };
  };
  return (body.item ?? body).excerpt;
}

/** Restore the offered recovery point, confirming where the offer asks. */
async function restoreOffered(
  page: Page,
  offer: ReturnType<Page["getByRole"]>
): Promise<void> {
  await offer.getByRole("button", { name: "Restore" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => confirm.getByRole("button", { name: /restore/i }).click())
    .catch(() => {});
}

test.describe(
  "a save made from a copy changed since",
  { tag: EVERY_DIALECT },
  () => {
    test.describe.configure({ timeout: 120_000 });

    test("entry: a stale save names who changed it and when and keeps the edits", async ({
      page,
      baseURL,
    }) => {
      const { id } = await openPost(page);
      const other = await colleague(page.request, baseURL);
      try {
        const mine = await staleSave(page, id, other.api, "Theirs");

        await expect(conflict(page)).toBeVisible({ timeout: 30_000 });
        await expect(conflict(page)).toContainText(
          new RegExp(`${other.name} changed it at`)
        );
        // Kept on screen, still unsaved, once the author goes on editing.
        await conflict(page)
          .getByRole("button", { name: "Keep editing" })
          .click();
        await expect(excerpt(page)).toHaveValue(mine);
        // Nothing of the refused save was stored.
        expect(await storedExcerpt(page, id)).toBe("Theirs");
      } finally {
        await other.api.dispose();
      }
    });

    test("entry: load current keeps the edits recoverable", async ({
      page,
      baseURL,
    }) => {
      const { id } = await openPost(page);
      const other = await colleague(page.request, baseURL);
      try {
        const mine = await staleSave(page, id, other.api, "Theirs");
        await conflict(page)
          .getByRole("button", { name: "Load current version" })
          .click();

        await expect(conflict(page)).toBeHidden({ timeout: 30_000 });
        await expect(excerpt(page)).toHaveValue("Theirs", { timeout: 30_000 });
        // The edits are a recovery point that says what changed since.
        const offer = page.getByRole("status").filter({
          hasText: /These edits began from an older version/,
        });
        await expect(offer).toBeVisible({ timeout: 30_000 });
        await expect(offer).toContainText(other.name);
        await restoreOffered(page, offer);
        await expect(excerpt(page)).toHaveValue(mine, { timeout: 30_000 });
      } finally {
        await other.api.dispose();
      }
    });

    test("entry: save anyway confirms, then overwrites", async ({
      page,
      baseURL,
    }) => {
      const { id } = await openPost(page);
      const other = await colleague(page.request, baseURL);
      try {
        const mine = await staleSave(page, id, other.api, "Theirs");
        await conflict(page)
          .getByRole("button", { name: "Save anyway" })
          .click();
        const confirm = page.getByRole("alertdialog", {
          name: new RegExp(`Replace ${other.name}'s changes`),
        });
        await expect(confirm).toContainText(
          new RegExp(`replaces the changes ${other.name} made`)
        );
        const saved = page.waitForResponse(
          r =>
            r.url().includes(`${POSTS}/${id}`) &&
            r.request().method() === "PATCH",
          { timeout: 30_000 }
        );
        await confirm
          .getByRole("button", { name: "Replace their changes" })
          .click();
        const answer = await saved;
        expect(answer.ok()).toBe(true);
        expect(answer.request().postDataJSON()).toMatchObject({
          _overwrite: true,
        });

        await expect(confirm).toBeHidden();
        expect(await storedExcerpt(page, id)).toBe(mine);
      } finally {
        await other.api.dispose();
      }
    });

    test("entry: links the comparison", async ({ page, baseURL }) => {
      const { id } = await openPost(page);
      const other = await colleague(page.request, baseURL);
      try {
        await staleSave(page, id, other.api, "Theirs");
        const link = conflict(page).getByRole("link", {
          name: `See what ${other.name} changed`,
        });
        await expect(link).toBeVisible({ timeout: 30_000 });
        await expect(link).toHaveAttribute(
          "href",
          new RegExp(`/collections/posts/${id}/versions\\?.*from=previous`)
        );
        // In a tab of its own, the unsaved edits left where they are.
        const [comparison] = await Promise.all([
          page.waitForEvent("popup"),
          link.click(),
        ]);
        await expect(comparison).toHaveURL(/\/versions\?/, { timeout: 30_000 });
        await expect(comparison.getByText("Theirs").first()).toBeVisible({
          timeout: 30_000,
        });
        await comparison.close();
      } finally {
        await other.api.dispose();
      }
    });

    test("Single: a stale save names who changed it and when and keeps the edits", async ({
      page,
      baseURL,
    }) => {
      const tagline = page.getByRole("textbox", {
        name: "Tagline",
        exact: true,
      });
      const read = await page.request.get(SITE_SETTINGS);
      const { siteName } = (await read.json()) as { siteName?: string | null };
      const seeded = await page.request.patch(SITE_SETTINGS, {
        data: {
          tagline: `Stored ${uniqueTag()}`,
          siteName: siteName || "Nextly",
        },
      });
      expect(seeded.ok(), await seeded.text()).toBe(true);
      await gotoAdmin(page, "/singles/site-settings");
      await expect(tagline).toBeEditable({ timeout: 30_000 });

      const other = await colleague(page.request, baseURL);
      try {
        const mine = `My tagline ${uniqueTag()}`;
        await tagline.fill(mine);
        const written = await other.api.patch(SITE_SETTINGS, {
          data: { tagline: "Theirs" },
        });
        expect(written.ok(), await written.text()).toBe(true);
        await page.getByRole("button", { name: "Save", exact: true }).click();

        await expect(conflict(page)).toBeVisible({ timeout: 30_000 });
        await expect(conflict(page)).toContainText(
          new RegExp(`${other.name} changed it at`)
        );
        await conflict(page)
          .getByRole("button", { name: "Keep editing" })
          .click();
        await expect(tagline).toHaveValue(mine);
      } finally {
        await other.api.dispose();
      }
    });

    test("Page Builder screen: a stale save is shown as a conflict", async ({
      page,
      baseURL,
    }) => {
      const layout = (texts: string[]) => ({
        formatVersion: 1,
        kind: "page",
        nodes: texts.map((text, at) => ({
          id: `conflict-${at}`,
          type: "core/heading",
          version: 1,
          props: { text, level: "h2" },
        })),
      });
      const seeded = await page.request.patch(HOMEPAGE, {
        data: { layout: layout(["First", "Second"]) },
      });
      expect(seeded.ok(), await seeded.text()).toBe(true);
      await gotoAdmin(page, "/singles/homepage/builder?field=layout");
      const second = canvasFrame(page)
        .locator('.nx-canvas [data-nx-node="conflict-1"]')
        .first();
      await expect(second).toBeVisible({ timeout: 30_000 });

      const other = await colleague(page.request, baseURL);
      try {
        await second.click();
        await page.keyboard.press("Delete");
        const written = await other.api.patch(HOMEPAGE, {
          data: { layout: layout(["First", "Second", "Third by them"]) },
        });
        expect(written.ok(), await written.text()).toBe(true);
        await pressSave(page);

        await expect(conflict(page)).toBeVisible({ timeout: 30_000 });
        await expect(conflict(page)).toContainText(other.name);
      } finally {
        await other.api.dispose();
      }
    });

    for (const kind of ["entry", "Single"] as const) {
      test(`${kind}: a second editor's first claim lands after the first saved and left, and their save is refused naming them`, async ({
        page,
        browser,
        baseURL,
      }) => {
        // The second editor's read of the document is taken, then held back
        // until the first has saved and left: the second's form starts from
        // the version before the first's save, and its claim lands only once
        // the first has gone.
        let address: string;
        let readPath: RegExp;
        let writeUrl: string;
        let field: (p: Page) => ReturnType<Page["getByRole"]>;
        let save: (p: Page) => Promise<void>;
        if (kind === "entry") {
          const tag = uniqueTag();
          const id = await createEntry(page.request, "posts", {
            title: `First claim ${tag}`,
            slug: `first-claim-${tag}`,
            excerpt: "Stored",
          });
          address = `/collections/posts/${id}`;
          readPath = new RegExp(`${POSTS}/${id}(\\?|$)`);
          writeUrl = `${POSTS}/${id}`;
          field = p =>
            p
              .locator("main")
              .getByRole("textbox", { name: "Excerpt", exact: true });
          save = p =>
            p
              .getByRole("button", { name: /^Save( draft)?$/ })
              .first()
              .click();
        } else {
          const read = await page.request.get(SITE_SETTINGS);
          const { siteName } = (await read.json()) as {
            siteName?: string | null;
          };
          const seeded = await page.request.patch(SITE_SETTINGS, {
            data: { tagline: "Stored", siteName: siteName || "Nextly" },
          });
          expect(seeded.ok(), await seeded.text()).toBe(true);
          address = "/singles/site-settings";
          readPath = new RegExp(`${SITE_SETTINGS}(\\?|$)`);
          writeUrl = SITE_SETTINGS;
          field = p => p.getByRole("textbox", { name: "Tagline", exact: true });
          save = p =>
            p.getByRole("button", { name: "Save", exact: true }).click();
        }

        // The reads a form makes as it opens, counted on the first editor's:
        // the second's form makes the same ones.
        const opening = new Set<string>();
        const countRead = (request: Request) => {
          if (request.method() === "GET" && readPath.test(request.url())) {
            opening.add(request.url());
          }
        };
        page.on("request", countRead);
        await gotoAdmin(page, address);
        await expect(field(page)).toBeEditable({ timeout: 30_000 });
        page.off("request", countRead);

        const other = await secondEditor(browser, page, baseURL);
        try {
          // B's reads are answered as they stood before A's save, every one of
          // them: the window this case is about is the one in which B has not
          // yet seen A's change, which any later read would show it.
          let release: () => void = () => {};
          const released = new Promise<void>(resolve => {
            release = resolve;
          });
          const before = new Map<
            string,
            Awaited<ReturnType<typeof fetchFirst>>
          >();
          const fetchFirst = (
            route: Parameters<Parameters<Page["route"]>[1]>[0]
          ) => route.fetch();
          await other.page.route(readPath, async route => {
            if (route.request().method() !== "GET") return route.fallback();
            const key = route.request().url();
            if (!before.has(key)) before.set(key, await fetchFirst(route));
            await released;
            await route.fulfill({ response: before.get(key) });
          });
          // B's first claim too: it reaches the server only once A has left,
          // so it is answered acquired rather than held, and nothing reloads.
          await other.page.route(
            "**/admin/api/document-lock**",
            async route => {
              if (route.request().method() !== "POST") return route.fallback();
              await released;
              await route.continue();
            }
          );
          await gotoAdmin(other.page, address);
          // Every read B's form opens with has reached the server before A
          // saves, so each holds the version before A's save.
          await expect
            .poll(() => before.size, { timeout: 30_000 })
            .toBeGreaterThanOrEqual(opening.size);

          // A saves and leaves.
          await field(page).fill(`Saved by the first ${uniqueTag()}`);
          const stored = page.waitForResponse(
            r => r.url().includes(writeUrl) && r.request().method() === "PATCH",
            { timeout: 30_000 }
          );
          await save(page);
          expect((await stored).ok()).toBe(true);
          await gotoAdmin(page, "/");
          release();

          // B's form unlocks from the older read, and B's save is refused.
          await expect(field(other.page)).toBeEditable({ timeout: 60_000 });
          await field(other.page).fill(`Mine ${uniqueTag()}`);
          await save(other.page);
          await expect(conflict(other.page)).toBeVisible({ timeout: 30_000 });
          // Named as the first editor is named: not the second.
          await expect(conflict(other.page)).toContainText(/changed it at/);
          await expect(conflict(other.page)).not.toContainText(SECOND_EDITOR);
        } finally {
          await other.context.close();
        }
      });
    }
  }
);
