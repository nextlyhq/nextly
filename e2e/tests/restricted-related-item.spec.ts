/**
 * A related item the editor may not read stays in the field as a placeholder,
 * and a save keeps it.
 *
 * The editor reads Posts, Categories and the Related links Single, and may
 * change Posts and the Single; Tags and media are out of reach. So a post's
 * tags and featured image, and the Single's tags and logo, are links the
 * editor's populated read leaves out. Each shows as a "Restricted or missing
 * item" with its id, can be removed, and cannot be opened; a save that leaves
 * it keeps it, and a save that removes it drops it. What was stored is read
 * back as the super-admin, at depth 0, so the assertion sees the database
 * rather than what the editor is shown.
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { fileAccount, test } from "./support/test";

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
let tagIds: [string, string];
let categoryId: string;
let mediaId: string;
let postId: string;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (baseURL === undefined) throw new Error("[e2e] No baseURL configured.");
  admin = await playwright.request.newContext({
    baseURL,
    storageState: await fileAccount(baseURL, testInfo),
  });

  const run = Date.now().toString(36);
  tagIds = [
    await createEntry(admin, "tags", {
      title: "Hidden tag one",
      slug: `hidden-one-${run}`,
    }),
    await createEntry(admin, "tags", {
      title: "Hidden tag two",
      slug: `hidden-two-${run}`,
    }),
  ];
  categoryId = await createEntry(admin, "categories", {
    title: "Readable category",
    slug: `readable-${run}`,
  });
  const uploaded = await admin.post("/admin/api/media", {
    multipart: {
      file: { name: `hidden-${run}.png`, mimeType: "image/png", buffer: PNG },
    },
  });
  await expectOk(uploaded, "uploading the media");
  const media = (await uploaded.json()) as {
    item?: { id: string };
    id?: string;
  };
  mediaId = String(media.item?.id ?? media.id);

  limited = await signInAsLimitedUser(browser, admin, baseURL, [
    "read-posts",
    "update-posts",
    "read-categories",
    `read-${SINGLE}`,
    `update-${SINGLE}`,
  ]);
  page = await limited.context.newPage();
});

test.afterAll(async () => {
  await limited?.context.close();
  if (mediaId) await admin?.delete(`/admin/api/media/${mediaId}`);
  await admin?.dispose();
});

/** A fresh post linking both tags, the category and the image. */
async function freshPost(): Promise<string> {
  return createEntry(admin, "posts", {
    title: "Post with hidden links",
    slug: `hidden-links-${Date.now().toString(36)}`,
    categories: [categoryId],
    tags: tagIds,
    featuredImage: mediaId,
  });
}

/** The Single, reset to link both tags and the image. */
async function resetSingle(): Promise<void> {
  await expectOk(
    await admin.patch(`/admin/api/singles/${SINGLE}`, {
      data: { headline: "Links", featuredTags: tagIds, logo: mediaId },
    }),
    "resetting the Single"
  );
}

/**
 * What is stored, read as the super-admin without populating anything. A post
 * is a draft, which only a read asking for every status returns.
 */
async function stored(path: string): Promise<Record<string, unknown>> {
  const response = await admin.get(`/admin/api/${path}?depth=0&status=all`);
  await expectOk(response, `reading ${path}`);
  const body = (await response.json()) as Record<string, unknown> & {
    item?: Record<string, unknown>;
  };
  return body.item ?? body;
}

const placeholder = (id: string): Locator =>
  page.getByRole("group", { name: `${LABEL} ${id}` });

/** A placeholder shows its id, offers removal, and nothing that opens it. */
async function expectPlaceholder(id: string): Promise<void> {
  const row = placeholder(id);
  await expect(row).toBeVisible();
  await expect(row).toContainText(LABEL);
  await expect(row).toContainText(id);
  await expect(row.getByRole("button")).toHaveCount(1);
  await expect(
    row.getByRole("button", { name: `Remove ${LABEL.toLowerCase()} ${id}` })
  ).toBeVisible();
  await expect(row.getByRole("link")).toHaveCount(0);
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

test.describe("on a collection entry", () => {
  test.beforeEach(async () => {
    postId = await freshPost();
    await gotoAdmin(page, `/collections/posts/${postId}`);
  });

  test("shows each hidden tag and the hidden image as a placeholder, beside the readable category", async () => {
    await expect(page.getByText("Readable category")).toBeVisible();
    await expectPlaceholder(tagIds[0]);
    await expectPlaceholder(tagIds[1]);
    await expectPlaceholder(mediaId);
    // The readable row is not a placeholder.
    await expect(placeholder(categoryId)).toHaveCount(0);
  });

  test("keeps the hidden links, in order, when the post is saved", async () => {
    await expectPlaceholder(tagIds[0]);
    await page.getByLabel("Excerpt").fill("Edited by someone who sees less");
    await save(`/entries/${postId}`);
    const after = await stored(`collections/posts/entries/${postId}`);
    expect(after.tags).toEqual(tagIds);
    expect(after.featuredImage).toBe(mediaId);
    expect(after.categories).toEqual([categoryId]);
  });

  test("drops a hidden link the editor removes, and keeps the rest", async () => {
    await placeholder(tagIds[0])
      .getByRole("button", {
        name: `Remove ${LABEL.toLowerCase()} ${tagIds[0]}`,
      })
      .click();
    await expect(placeholder(tagIds[0])).toHaveCount(0);
    await placeholder(mediaId).getByRole("button").click();
    await save(`/entries/${postId}`);
    const after = await stored(`collections/posts/entries/${postId}`);
    expect(after.tags).toEqual([tagIds[1]]);
    expect(after.featuredImage ?? null).toBeNull();
  });
});

test.describe("on a Single", () => {
  test.beforeEach(async () => {
    await resetSingle();
    await gotoAdmin(page, `/singles/${SINGLE}`);
  });

  test("shows the hidden tags and the hidden logo as placeholders", async () => {
    await expectPlaceholder(tagIds[0]);
    await expectPlaceholder(tagIds[1]);
    await expectPlaceholder(mediaId);
  });

  test("keeps the hidden links, in order, when the Single is saved", async () => {
    await expectPlaceholder(tagIds[0]);
    await page.getByLabel("Headline").fill("Edited links");
    await save(`/singles/${SINGLE}`);
    const after = await stored(`singles/${SINGLE}`);
    expect(after.headline).toBe("Edited links");
    expect(after.featuredTags).toEqual(tagIds);
    expect(after.logo).toBe(mediaId);
  });

  test("drops a hidden link the editor removes, and keeps the rest", async () => {
    await placeholder(tagIds[1])
      .getByRole("button", {
        name: `Remove ${LABEL.toLowerCase()} ${tagIds[1]}`,
      })
      .click();
    await placeholder(mediaId).getByRole("button").click();
    await save(`/singles/${SINGLE}`);
    const after = await stored(`singles/${SINGLE}`);
    expect(after.featuredTags).toEqual([tagIds[0]]);
    expect(after.logo ?? null).toBeNull();
  });
});
