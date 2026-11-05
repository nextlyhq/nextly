/**
 * Every update the admin makes to an entry or a Single carries the version
 * the editor's copy started from.
 *
 * Recorded at the network: each write the admin sends to a document is read
 * back, and none goes without a version. A save, a held working-draft save, a
 * publish, an unpublish, a restore and a list's bulk publish for an entry;
 * a save and the Page Builder screen's save for a Single.
 *
 * @module tests/admin-sends-version
 */
import { expect, type Page, type Request } from "@playwright/test";

import { pressSave } from "./canvas/editor-driver";
import { uniqueTag } from "./support/accounts";
import { gotoAdmin } from "./support/admin";
import { canvasFrame } from "./support/canvas-frame";
import { EVERY_DIALECT } from "./support/every-dialect";
import { LOCK } from "./support/locks";
import { createEntry } from "./support/runtime-collection";
import { test } from "./support/test";

test.describe.configure({ lock: [LOCK.siteSettings, LOCK.homepage] });

const POSTS = "/admin/api/collections/posts/entries";
const SITE_SETTINGS = "/admin/api/singles/site-settings";
const HOMEPAGE = "/admin/api/singles/homepage";

/** What a write sent: its method, address and body. */
interface SentWrite {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * The writes that update a document: a save, publishing every language, a
 * restore, a pending change discarded or brought up to date, a bulk update.
 * Not a recovery point, a version's name or a read marker, which change no
 * document.
 */
const UPDATE =
  /(?:\/entries\/[^/]+$|\/singles\/[^/]+$|\/publish-all$|\/unpublish-all$|\/versions\/\d+\/restore$|\/working-draft$|\/take-live$|\/bulk-update$)/;

/** Every document update the page sends under `prefix` from now on. */
function recordWrites(page: Page, prefix: string): SentWrite[] {
  const sent: SentWrite[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "GET") return;
    const path = new URL(request.url()).pathname;
    if (!path.startsWith(prefix) || !UPDATE.test(path)) return;
    let body: Record<string, unknown> | null = null;
    try {
      body = request.postDataJSON() as Record<string, unknown> | null;
    } catch {
      body = null;
    }
    sent.push({ method: request.method(), url: request.url(), body });
  });
  return sent;
}

/** The version a write carries: in its body, its query, or per id in `revs`. */
function versionOf(write: SentWrite, id: string): unknown {
  const query = new URL(write.url).searchParams.get("_rev");
  if (query) return query;
  const body = write.body ?? {};
  if (typeof body._rev === "string") return body._rev;
  const revs = body.revs as Record<string, unknown> | undefined;
  return revs?.[id];
}

/** Waits for the next write the page sends matching `matches`. */
const nextWrite = (page: Page, matches: (r: Request) => boolean) =>
  page.waitForRequest(r => r.method() !== "GET" && matches(r), {
    timeout: 30_000,
  });

const excerpt = (page: Page) =>
  page.locator("main").getByRole("textbox", { name: "Excerpt", exact: true });

test.describe("the admin sends a version", { tag: EVERY_DIALECT }, () => {
  test.describe.configure({ timeout: 180_000 });

  test("every update request for an entry carries a version", async ({
    page,
  }) => {
    const tag = uniqueTag();
    const id = await createEntry(page.request, "posts", {
      title: `Versioned ${tag}`,
      slug: `versioned-${tag}`,
      excerpt: "Stored",
    });
    const writes = recordWrites(page, POSTS);
    const toThis = (r: Request) => r.url().includes(`${POSTS}/${id}`);
    await gotoAdmin(page, `/collections/posts/${id}`);
    await expect(excerpt(page)).toBeEditable({ timeout: 30_000 });

    // A save of the draft.
    await excerpt(page).fill(`Draft ${tag}`);
    let sent = nextWrite(page, toThis);
    await page
      .getByRole("button", { name: /^Save draft$/ })
      .first()
      .click();
    await sent;

    // A publish. The form takes in the published entry once the read after
    // the publish comes back, and an edit typed before that is reset by it,
    // so the next edit waits for that read and for the form to show it.
    sent = nextWrite(page, toThis);
    let publishAnswered = false;
    const readAfterPublish = page.waitForResponse(
      r => {
        const sameEntry = new URL(r.url()).pathname === `${POSTS}/${id}`;
        if (sameEntry && r.request().method() === "PATCH") {
          publishAnswered = true;
          return false;
        }
        return publishAnswered && sameEntry && r.request().method() === "GET";
      },
      { timeout: 30_000 }
    );
    await page
      .getByRole("button", { name: "Publish", exact: true })
      .first()
      .click();
    await sent;
    await readAfterPublish;
    await expect(
      page.locator("main").getByText("Published", { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });

    // A held working-draft save, of the published entry.
    const saveChanges = page
      .getByRole("button", { name: /^Save( draft| changes)?$/ })
      .first();
    await expect(async () => {
      await excerpt(page).fill(`Pending ${tag}`);
      await expect(saveChanges).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    sent = nextWrite(page, toThis);
    await page
      .getByRole("button", { name: /^Save( draft| changes)?$/ })
      .first()
      .click();
    await sent;

    // An unpublish, from the document's own menu.
    sent = nextWrite(page, toThis);
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Unpublish" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Unpublish" })
      .click();
    await sent;

    // A restore of an earlier version.
    await gotoAdmin(page, `/collections/posts/${id}?history=1`);
    const rows = page.getByRole("button", { name: /Version \d+/ });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await rows.last().click();
    await page
      .getByRole("button", { name: "Restore this version" })
      .first()
      .click();
    sent = nextWrite(page, r => r.url().includes(`${POSTS}/${id}/versions/`));
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Restore version \d+$/ })
      .click();
    await sent;

    // A list's bulk publish.
    await gotoAdmin(page, "/collections/posts");
    // A row that opens its entry is a button; the phone-width card drawing
    // the same entry stays hidden.
    const row = page
      .getByRole("button", { name: new RegExp(`Versioned ${tag}`) })
      .filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("checkbox", { name: "Select row" }).click();
    sent = nextWrite(page, r => r.url().includes(`${POSTS}/bulk-update`));
    await page
      .getByRole("button", { name: "Publish selected", exact: true })
      .click();
    await sent;

    // Six writes, every one carrying a version.
    expect(writes.length).toBeGreaterThanOrEqual(6);
    for (const write of writes) {
      expect(
        {
          write: `${write.method} ${new URL(write.url).pathname}`,
          version: versionOf(write, id),
        },
        "every write carries the version its copy started from"
      ).toEqual({
        write: `${write.method} ${new URL(write.url).pathname}`,
        version: expect.stringMatching(/^\d+/),
      });
    }
  });

  test("every update request for a Single carries a version", async ({
    page,
  }) => {
    const read = await page.request.get(SITE_SETTINGS);
    const { siteName } = (await read.json()) as { siteName?: string | null };
    const seeded = await page.request.patch(SITE_SETTINGS, {
      data: { tagline: "Stored", siteName: siteName || "Nextly" },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
    const settingsWrites = recordWrites(page, SITE_SETTINGS);
    await gotoAdmin(page, "/singles/site-settings");
    const tagline = page.getByRole("textbox", { name: "Tagline", exact: true });
    await expect(tagline).toBeEditable({ timeout: 30_000 });
    await tagline.fill(`Mine ${uniqueTag()}`);
    let sent = nextWrite(page, r => r.url().includes(SITE_SETTINGS));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await sent;

    // The Page Builder screen's save, of the homepage's layout.
    const layout = {
      formatVersion: 1,
      kind: "page",
      nodes: ["First", "Second"].map((text, at) => ({
        id: `sends-${at}`,
        type: "core/heading",
        version: 1,
        props: { text, level: "h2" },
      })),
    };
    const stored = await page.request.patch(HOMEPAGE, { data: { layout } });
    expect(stored.ok(), await stored.text()).toBe(true);
    const homepageWrites = recordWrites(page, HOMEPAGE);
    await gotoAdmin(page, "/singles/homepage/builder?field=layout");
    const second = canvasFrame(page)
      .locator('.nx-canvas [data-nx-node="sends-1"]')
      .first();
    await expect(second).toBeVisible({ timeout: 30_000 });
    await second.click();
    await page.keyboard.press("Delete");
    sent = nextWrite(page, r => r.url().includes(HOMEPAGE));
    await pressSave(page);
    await sent;

    const writes = [...settingsWrites, ...homepageWrites];
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (const write of writes) {
      expect(versionOf(write, ""), `${write.method} ${write.url}`).toEqual(
        expect.stringMatching(/^\d+/)
      );
    }
  });
});
