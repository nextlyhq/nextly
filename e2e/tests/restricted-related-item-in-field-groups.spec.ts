/**
 * A related item the editor may not read, inside a field group, stays in the
 * field as a placeholder, and a save keeps it.
 *
 * The editor reads and changes Linked entries and the Related links Single;
 * Tags and media are out of reach. Each document holds a link card (to-many
 * tags and an image) and a dynamic zone of a quote (one tag) and another card,
 * so every link inside them is one the editor's populated read leaves out.
 * Each shows as a "Restricted or missing item" with its id; a save that leaves
 * it keeps it in order, and a save that removes it drops it. What was stored is
 * read back as the super-admin at depth 0, so the assertion sees the database
 * rather than what the editor is shown.
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { test } from "./support/test";
import { STORAGE_STATE } from "../global-setup";

import { gotoAdmin } from "./support/admin";
import { signInAsLimitedUser, type LimitedUser } from "./support/limited-user";
import { createEntry, expectOk } from "./support/runtime-collection";
import { LOCK } from "./support/locks";

// One signed-in user for the whole file: signing in spends the auth budget.
// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({
  mode: "serial",
  lock: [LOCK.usersRoles, LOCK.relatedLinks],
});

const COLLECTION = "linked-entries";
const SINGLE = "related-links";
const LABEL = "Restricted or missing item";

/** A 1×1 transparent PNG, the smallest upload the media library accepts. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

let admin: APIRequestContext;
let limited: LimitedUser;
let page: Page;
/** Four tags, so every link in a document has an id of its own. */
let tags: [string, string, string, string];
let mediaId: string;

type Doc = Record<string, unknown>;

/** The document claims this spec's editor was given, to give back at the end. */
const claims: Doc[] = [];

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: STORAGE_STATE,
  });

  const run = Date.now().toString(36);
  const tag = (n: number) =>
    createEntry(admin, "tags", {
      title: `Hidden tag ${n}`,
      slug: `hidden-group-${n}-${run}`,
    });
  tags = [await tag(1), await tag(2), await tag(3), await tag(4)];
  const uploaded = await admin.post("/admin/api/media", {
    multipart: {
      file: { name: `group-${run}.png`, mimeType: "image/png", buffer: PNG },
    },
  });
  await expectOk(uploaded, "uploading the media");
  const media = (await uploaded.json()) as {
    item?: { id: string };
    id?: string;
  };
  mediaId = String(media.item?.id ?? media.id);

  limited = await signInAsLimitedUser(browser, admin, baseURL, [
    `read-${COLLECTION}`,
    `update-${COLLECTION}`,
    `read-${SINGLE}`,
    `update-${SINGLE}`,
  ]);
  page = await limited.context.newPage();
  page.on("response", response => {
    if (
      !response.url().includes("/admin/api/document-lock") ||
      response.request().method() !== "POST"
    ) {
      return;
    }
    const sent = response.request().postDataJSON() as Doc | null;
    void response
      .json()
      .then((body: { item?: { claimToken?: string } }) => {
        const claimToken = body.item?.claimToken;
        if (sent && claimToken) claims.push({ ...sent, claimToken });
      })
      .catch(() => undefined);
  });
});

test.afterAll(async () => {
  // Give back every claim this spec's editor took on a document. The Single is
  // shared with another spec, whose editor would otherwise open it read-only
  // until the claim lapsed; a release sent as the page unloads is not waited
  // for, so it is sent here instead, once the page has stopped renewing them.
  await page?.close();
  for (const claim of claims) {
    await limited?.context.request
      .delete("/admin/api/document-lock", { data: claim })
      .catch(() => undefined);
  }
  await limited?.context.close();
  if (mediaId) await admin?.delete(`/admin/api/media/${mediaId}`);
  await admin?.dispose();
});

/** A link card and a dynamic zone, every link hidden from the editor. */
const groups = (): Doc => ({
  card: { heading: "Card", cardTags: [tags[0], tags[1]], cardImage: mediaId },
  blocks: [
    { _componentType: "link-quote", quoteTag: tags[2] },
    { _componentType: "link-card", heading: "Zone card", cardTags: [tags[3]] },
  ],
});

/** What is stored, read as the super-admin without populating anything. */
async function stored(path: string): Promise<Doc> {
  const response = await admin.get(`/admin/api/${path}?depth=0&status=all`);
  await expectOk(response, `reading ${path}`);
  const body = (await response.json()) as Doc & { item?: Doc };
  return body.item ?? body;
}

/** A field group's instance, read as one or as a list of one. */
const instance = (value: unknown): Doc =>
  (Array.isArray(value) ? value[0] : value) as Doc;

/** The links stored in a document's field groups. */
function groupLinks(doc: Doc) {
  const card = instance(doc.card);
  const blocks = (doc.blocks ?? []) as Doc[];
  return {
    cardTags: card.cardTags,
    cardImage: card.cardImage ?? null,
    blocks: blocks.map(row =>
      "quoteTag" in row
        ? { quoteTag: row.quoteTag }
        : { cardTags: row.cardTags }
    ),
  };
}

const placeholder = (id: string): Locator =>
  page.getByRole("group", { name: `${LABEL} ${id}` });

/** A placeholder shows its id, offers removal, and nothing that opens it. */
async function expectPlaceholder(id: string): Promise<void> {
  const row = placeholder(id);
  await expect(row).toBeVisible();
  await expect(row).toContainText(id);
  await expect(row.getByRole("button")).toHaveCount(1);
  await expect(row.getByRole("link")).toHaveCount(0);
}

/** Every link in the field groups, shown as a placeholder. */
async function expectAllPlaceholders(): Promise<void> {
  for (const id of [...tags, mediaId]) await expectPlaceholder(id);
}

/** Save the form, and wait for the write it makes. */
async function save(path: string): Promise<void> {
  const written = page.waitForResponse(
    response =>
      response.url().includes(path) &&
      ["PATCH", "PUT"].includes(response.request().method())
  );
  await page
    .getByRole("button", { name: /^(Save draft|Save changes|Save)$/ })
    .first()
    .click();
  expect((await written).ok()).toBe(true);
}

const remove = (id: string) =>
  placeholder(id)
    .getByRole("button", { name: `Remove ${LABEL.toLowerCase()} ${id}` })
    .click();

test.describe("on a collection entry", () => {
  let entryId: string;

  test.beforeEach(async () => {
    entryId = await createEntry(admin, COLLECTION, {
      title: `Linked ${Date.now().toString(36)}`,
      ...groups(),
    });
    await gotoAdmin(page, `/collections/${COLLECTION}/${entryId}`);
  });

  test("shows each hidden link in a field group and a dynamic zone as a placeholder", async () => {
    await expectAllPlaceholders();
  });

  test("keeps the hidden links in field groups, in order, when the entry is saved", async () => {
    const before = groupLinks(
      await stored(`collections/${COLLECTION}/entries/${entryId}`)
    );
    await expectPlaceholder(tags[0]);
    await page.getByLabel("Title").fill("Edited by someone who sees less");
    await save(`/entries/${entryId}`);
    const after = await stored(`collections/${COLLECTION}/entries/${entryId}`);
    expect(after.title).toBe("Edited by someone who sees less");
    expect(groupLinks(after)).toEqual(before);
    expect(groupLinks(after).cardTags).toEqual([tags[0], tags[1]]);
  });

  test("drops the hidden links the editor removes inside field groups, and keeps the rest", async () => {
    await remove(tags[3]);
    await remove(mediaId);
    await expect(placeholder(tags[3])).toHaveCount(0);
    await save(`/entries/${entryId}`);
    const after = groupLinks(
      await stored(`collections/${COLLECTION}/entries/${entryId}`)
    );
    expect(after.cardTags).toEqual([tags[0], tags[1]]);
    expect(after.cardImage).toBeNull();
    expect(after.blocks).toEqual([{ quoteTag: tags[2] }, { cardTags: [] }]);
  });
});

test.describe("on a Single", () => {
  test.beforeEach(async () => {
    await expectOk(
      await admin.patch(`/admin/api/singles/${SINGLE}`, {
        data: { headline: "Links", ...groups() },
      }),
      "resetting the Single"
    );
    await gotoAdmin(page, `/singles/${SINGLE}`);
  });

  test("shows each hidden link in a field group and a dynamic zone as a placeholder", async () => {
    await expectAllPlaceholders();
  });

  test("keeps the hidden links in field groups, in order, when the Single is saved", async () => {
    const before = groupLinks(await stored(`singles/${SINGLE}`));
    await expectPlaceholder(tags[0]);
    await page.getByLabel("Headline").fill("Edited links");
    await save(`/singles/${SINGLE}`);
    const after = await stored(`singles/${SINGLE}`);
    expect(after.headline).toBe("Edited links");
    expect(groupLinks(after)).toEqual(before);
  });

  test("drops the hidden links the editor removes inside field groups, and keeps the rest", async () => {
    await remove(tags[2]);
    await save(`/singles/${SINGLE}`);
    const after = groupLinks(await stored(`singles/${SINGLE}`));
    expect(after.cardTags).toEqual([tags[0], tags[1]]);
    expect(after.cardImage).toBe(mediaId);
    expect(after.blocks).toEqual([{ quoteTag: null }, { cardTags: [tags[3]] }]);
  });
});
