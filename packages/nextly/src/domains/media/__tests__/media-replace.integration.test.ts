/**
 * Replacing a media item's file keeps the item, on every dialect, over the
 * admin's media route: the same id, name, alt text, caption, folder and
 * usage; a new address and thumbnail; a document using the item resolves to
 * the new file; the old files go and the new ones stay. A file the upload
 * checks refuse is refused here too, leaving the item as it was.
 *
 * The old files stay while anything names the old address (rich text, an
 * email template, an avatar, a site logo) and while the usage record is
 * still being built, and they go with the item on every delete path.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaHandlers } from "../../../api/media-handlers";
import {
  defineCollection,
  json,
  richText,
  text,
  upload,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { MEDIA_USAGE_TABLE } from "../../../schemas/media-usage/table-name";
import { ServiceContainer } from "../../../services/index";
import {
  HTML_DOCUMENT,
  PNG_1X1,
  pdfDocument,
} from "../../../services/upload-validation/__tests__/format-fixtures";
import { getMediaStorage } from "../../../storage/storage";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";
import { isMediaThumbnail } from "../orphan-thumbnails";
import {
  PENDING_DELETE_WINDOW_MS,
  PendingMediaDeletes,
} from "../pending-delete";
import { readReplacedRecord } from "../usage/address-uses";
import { MEDIA_USAGE_RECORDED_KEY } from "../usage/media-usage-store";
import { reindexMediaUsage } from "../usage/reindex-usage";

type Doc = Record<string, unknown>;

/** The ids of these seeded grants, seeding the system ones first. */
async function grantIds(t: TestNextly, slugs: string[]): Promise<string[]> {
  const nextly = t.nextly as unknown as {
    permissions: {
      find: (a: { page: number; limit: number }) => Promise<{
        items: { id: string; slug: string }[];
        meta: { hasNext: boolean };
      }>;
    };
  };
  await (
    t.getService("permissionSeedService") as {
      seedSystemPermissions: () => Promise<unknown>;
    }
  ).seedSystemPermissions();
  const seeded: { id: string; slug: string }[] = [];
  for (let page = 1; ; page += 1) {
    const listed = await nextly.permissions.find({ page, limit: 100 });
    seeded.push(...listed.items);
    if (!listed.meta.hasNext) break;
  }
  return slugs.map(slug => {
    const found = seeded.find(p => p.slug === slug);
    expect(found, `\`${slug}\` must be seeded`).toBeDefined();
    return found!.id;
  });
}

/** An API key of a role holding exactly these grants, for a plain user. */
async function keyWith(t: TestNextly, grants: string[]): Promise<string> {
  const userId = await seedPlainAuthor(t);
  const slug = `replace-${randomUUID().slice(0, 8)}`;
  const role = await (
    t.nextly as unknown as {
      roles: {
        create: (a: { data: Record<string, unknown> }) => Promise<{
          item: { id: string };
        }>;
      };
    }
  ).roles.create({
    data: { name: slug, slug, permissionIds: await grantIds(t, grants) },
  });
  await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
    userId,
    role.item.id
  );
  const apiKeys = t.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(userId, {
    name: slug,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

/** A rich-text value showing one image, by its address. */
function imageText(url: string): Doc {
  return {
    root: {
      type: "root",
      version: 1,
      children: [{ type: "image", version: 1, src: url, altText: "" }],
    },
  };
}

/** `GET /admin/api/media/:id/usage`, optionally only the address uses. */
async function usageOf(key: string, mediaId: string, query = ""): Promise<Doc> {
  const path = [mediaId, "usage"];
  const res = await createMediaHandlers({ requireAuth: true }).GET(
    new Request(`http://localhost/admin/api/media/${path.join("/")}${query}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ path }) }
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Doc;
}

/** `POST /admin/api/media/:id/replace` with one file, as the holder of `key`. */
async function replace(
  key: string,
  mediaId: string,
  file: { data: Buffer; name: string; type: string }
): Promise<{ status: number; json: Doc }> {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(file.data)], file.name, { type: file.type })
  );
  const path = [mediaId, "replace"];
  const res = await createMediaHandlers({ requireAuth: true }).POST(
    new Request(`http://localhost/admin/api/media/${path.join("/")}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    }),
    { params: Promise.resolve({ path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

/** `DELETE /admin/api/media/:id`, or `/bulk` with `bulk`, as `key`. */
async function deleteNow(
  key: string,
  ids: string[],
  bulk = false
): Promise<number> {
  const path = bulk ? ["bulk"] : ids;
  const res = await createMediaHandlers({ requireAuth: true }).DELETE(
    new Request(`http://localhost/admin/api/media/${path.join("/")}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      ...(bulk ? { body: JSON.stringify({ mediaIds: ids }) } : {}),
    }),
    { params: Promise.resolve({ path }) }
  );
  return res.status;
}

describe.each(getConfiguredTestDialects())(
  "replacing a media item's file (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let editor: string;
    let folderId: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "replaceposts",
            fields: [
              text({ name: "title" }),
              upload({ name: "cover", relationTo: "media" }),
              richText({ name: "body" }),
              json({ name: "extra" }),
            ],
          }),
        ],
      });
      editor = await keyWith(t, ["read-media", "update-media"]);
      // A record already built: a new site's is from the start.
      await t.getService("metaService").set(MEDIA_USAGE_RECORDED_KEY, {
        rebuiltAt: new Date().toISOString(),
      });
      folderId = randomUUID();
      await t.adapter.insert("media_folders", {
        id: folderId,
        name: "Brand",
        createdBy: await seedPlainAuthor(t),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    async function row(id: string): Promise<Doc | undefined> {
      const rows = await t.adapter.select<Doc>("media", {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      return rows[0];
    }

    /** A logo with alt text and a caption, in the folder, used by a post. */
    async function usedLogo(): Promise<{ id: string; postId: string }> {
      const uploaded = await t.nextly.media.upload({
        file: {
          data: PNG_1X1,
          name: "logo.png",
          mimetype: "image/png",
          size: PNG_1X1.length,
        },
        folder: folderId,
        altText: "Our logo",
      });
      await t
        .getService("mediaService")
        .update(
          uploaded.id,
          { caption: "Since 2020", focalX: 20, focalY: 30 },
          {}
        );
      const created = await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "replaceposts", overrideAccess: true },
          { title: "Home", cover: uploaded.id }
        );
      return {
        id: uploaded.id,
        postId: String((created.data as { id?: unknown }).id),
      };
    }

    async function coverOf(postId: string): Promise<Doc> {
      const read = await t.nextly.find({
        collection: "replaceposts",
        where: { id: { equals: postId } },
        depth: 1,
      });
      return (read.items[0] as Doc).cover as Doc;
    }

    it("keeps the item and its usage, and the document using it shows the new file", async () => {
      const logo = await usedLogo();
      const before = (await row(logo.id))!;
      const oldPath = String(before.filename);
      expect((await coverOf(logo.postId)).url).toBe(before.url);

      const replaced = await replace(editor, logo.id, {
        data: PNG_1X1,
        name: "new-logo.png",
        type: "image/png",
      });

      expect(replaced.status).toBe(200);
      const after = (await row(logo.id))!;
      expect(after).toMatchObject({
        id: logo.id,
        // The item's own name, not the new file's.
        originalFilename: "logo.png",
        altText: "Our logo",
        caption: "Since 2020",
        folderId,
        mimeType: "image/png",
        focalX: null,
        focalY: null,
      });
      expect(after.url).not.toBe(before.url);
      expect(after.thumbnailUrl).toBeTruthy();
      expect(after.thumbnailUrl).not.toBe(before.thumbnailUrl);
      expect((replaced.json.item as Doc).id).toBe(logo.id);

      // The document resolves the same item, now showing the new file.
      expect(await coverOf(logo.postId)).toMatchObject({
        id: logo.id,
        url: after.url,
      });
      const usage = await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {
        where: { and: [{ column: "mediaId", op: "=", value: logo.id }] },
      });
      expect(usage).toHaveLength(1);

      // The old file is gone and the new one is stored.
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(false);
      expect(
        await getMediaStorage().exists(String(after.filename), "media")
      ).toBe(true);
    });

    it("replaces an image with a document, which has no size or thumbnail", async () => {
      const logo = await usedLogo();
      const pdf = pdfDocument("replace");
      const replaced = await replace(editor, logo.id, {
        data: pdf,
        name: "brand-guide.pdf",
        type: "application/pdf",
      });

      expect(replaced.status).toBe(200);
      expect(await row(logo.id)).toMatchObject({
        originalFilename: "logo.pdf",
        mimeType: "application/pdf",
        width: null,
        height: null,
        thumbnailUrl: null,
        altText: "Our logo",
      });
    });

    it("refuses a file an upload would refuse, and leaves the item as it was", async () => {
      const logo = await usedLogo();
      const before = await row(logo.id);
      const refused = await replace(editor, logo.id, {
        data: HTML_DOCUMENT,
        name: "page.html",
        type: "text/html",
      });

      expect(refused.status).toBe(400);
      expect(await row(logo.id)).toEqual(before);
    });

    it("needs the update permission, and answers an unknown item as not found", async () => {
      const logo = await usedLogo();
      const before = await row(logo.id);
      const reader = await keyWith(t, ["read-media"]);
      const file = { data: PNG_1X1, name: "x.png", type: "image/png" };

      expect((await replace(reader, logo.id, file)).status).toBe(403);
      expect(await row(logo.id)).toEqual(before);
      expect((await replace(editor, randomUUID(), file)).status).toBe(404);
    });

    it("keeps the old file while rich text or a template names the item by its address", async () => {
      const logo = await usedLogo();
      const before = (await row(logo.id))!;
      const oldPath = String(before.filename);
      const oldUrl = String(before.url);
      const handler = t.getService("collectionsHandler");
      const byAddress = await handler.createEntry(
        { collectionName: "replaceposts", overrideAccess: true },
        { title: "Story", body: imageText(oldUrl) }
      );
      const storyId = String((byAddress.data as { id?: unknown }).id);
      const template = await t
        .getService("emailTemplateService")
        .createTemplate({
          name: "Newsletter",
          slug: `replace-news-${dialect}`,
          subject: "News",
          htmlContent: `<p>Hi</p><img alt="" src="${oldUrl}">`,
        });
      const reader = await keyWith(t, [
        "read-media",
        "update-media",
        "read-replaceposts",
        "read-email-templates",
      ]);

      // Asked before replacing: the uses that keep the old file.
      const asked = await usageOf(reader, logo.id, "?byAddress=true");
      expect(
        (asked.items as Doc[]).map(item => item.documentId).sort()
      ).toEqual([storyId, template.id].sort());

      const replaced = await replace(reader, logo.id, {
        data: PNG_1X1,
        name: "new-logo.png",
        type: "image/png",
      });
      expect(replaced.status).toBe(200);
      const after = (await row(logo.id))!;

      // By id: the upload field shows the new file.
      expect(await coverOf(logo.postId)).toMatchObject({
        id: logo.id,
        url: after.url,
      });
      // By address: the old file is kept, whole, for the pages naming it.
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);
      expect(
        await getMediaStorage().getAdapterForCollection("media").read?.(oldPath)
      ).toEqual(PNG_1X1);
      // `media orphans` looks only at thumbnails, so never at this file.
      expect(isMediaThumbnail({ path: oldPath })).toBe(false);

      // Used in says which uses still show the previous file.
      const used = (await usageOf(reader, logo.id)).items as Array<{
        documentId: string;
        fields: Array<{ path: string; showsPreviousFile: boolean }>;
      }>;
      const shows = Object.fromEntries(
        used.flatMap(item =>
          item.fields.map(field => [
            `${item.documentId}:${field.path}`,
            field.showsPreviousFile,
          ])
        )
      );
      expect(shows).toEqual({
        [`${logo.postId}:cover`]: false,
        [`${storyId}:body`]: true,
        [`${template.id}:htmlContent`]: true,
      });

      // Saved again with the new address, the story shows the new file.
      await handler.updateEntry(
        {
          collectionName: "replaceposts",
          entryId: storyId,
          overrideAccess: true,
        },
        { body: imageText(String(after.url)) }
      );
      const story = (
        (await usageOf(reader, logo.id)).items as Array<{
          documentId: string;
          fields: Array<{ showsPreviousFile: boolean }>;
        }>
      ).find(item => item.documentId === storyId);
      expect(story?.fields[0]?.showsPreviousFile).toBe(false);

      // Deleting the item takes the kept file with it.
      await t.getService("mediaService").delete(logo.id, {});
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(false);
    });

    /** A logo replaced while a story names it by address: its kept file. */
    async function replacedWithKeptFile(): Promise<{
      id: string;
      oldPath: string;
    }> {
      const logo = await usedLogo();
      const before = (await row(logo.id))!;
      await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "replaceposts", overrideAccess: true },
          { title: "Kept", body: imageText(String(before.url)) }
        );
      const replaced = await replace(editor, logo.id, {
        data: PNG_1X1,
        name: "again.png",
        type: "image/png",
      });
      expect(replaced.status).toBe(200);
      const oldPath = String(before.filename);
      // POSITIVE CONTROL: the file and its record are there to remove.
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);
      expect(await readReplacedRecord(t.adapter, logo.id)).not.toBeNull();
      return { id: logo.id, oldPath };
    }

    it("removes the kept file and its record on an immediate delete, one item or a bulk one", async () => {
      const deleter = await keyWith(t, ["read-media", "delete-media"]);
      const one = await replacedWithKeptFile();
      const bulk = [await replacedWithKeptFile(), await replacedWithKeptFile()];

      expect(await deleteNow(deleter, [one.id])).toBe(200);
      expect(
        await deleteNow(
          deleter,
          bulk.map(item => item.id),
          true
        )
      ).toBe(200);

      for (const item of [one, ...bulk]) {
        expect(await row(item.id)).toBeUndefined();
        expect(await getMediaStorage().exists(item.oldPath, "media")).toBe(
          false
        );
        expect(await readReplacedRecord(t.adapter, item.id)).toBeNull();
      }
    });

    // A folder deleted with its contents removes each item the way a delete
    // of that item does, the files a Replace kept for it included.
    it("removes the kept file and its record when the item's folder is deleted with its contents", async () => {
      const deleter = await keyWith(t, ["read-media", "delete-media"]);
      const doomed = randomUUID();
      await t.adapter.insert("media_folders", {
        id: doomed,
        name: "Doomed",
        createdBy: await seedPlainAuthor(t),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const item = await replacedWithKeptFile();
      await t.adapter.update(
        "media",
        { folderId: doomed },
        { and: [{ column: "id", op: "=", value: item.id }] }
      );

      const path = ["folders", doomed];
      const res = await createMediaHandlers({ requireAuth: true }).DELETE(
        new Request(
          `http://localhost/admin/api/media/${path.join("/")}?deleteContents=true`,
          {
            method: "DELETE",
            headers: { authorization: `Bearer ${deleter}` },
          }
        ),
        { params: Promise.resolve({ path }) }
      );

      expect(res.status).toBe(200);
      expect(await row(item.id)).toBeUndefined();
      expect(await getMediaStorage().exists(item.oldPath, "media")).toBe(false);
      expect(await readReplacedRecord(t.adapter, item.id)).toBeNull();
    });

    /** Replace `id`'s file, and answer whether its old file is still served. */
    async function oldFileServedAfterReplace(id: string): Promise<boolean> {
      const oldPath = String((await row(id))!.filename);
      const replaced = await replace(editor, id, {
        data: PNG_1X1,
        name: "after.png",
        type: "image/png",
      });
      expect(replaced.status).toBe(200);
      if (!(await getMediaStorage().exists(oldPath, "media"))) return false;
      const bytes = await getMediaStorage()
        .getAdapterForCollection("media")
        .read?.(oldPath);
      expect(bytes).toEqual(PNG_1X1);
      return true;
    }

    /** An image nothing in content uses. */
    async function looseImage(): Promise<{ id: string; url: string }> {
      const uploaded = await t.nextly.media.upload({
        file: {
          data: PNG_1X1,
          name: `loose-${randomUUID().slice(0, 6)}.png`,
          mimetype: "image/png",
          size: PNG_1X1.length,
        },
      });
      return { id: uploaded.id, url: String((await row(uploaded.id))!.url) };
    }

    it("keeps the old file for an image used only as a user's avatar", async () => {
      const image = await looseImage();
      await t.adapter.insert("users", {
        id: `avatar-${randomUUID().slice(0, 8)}`,
        email: `avatar-${randomUUID().slice(0, 8)}@test.local`,
        image: image.url,
      });
      // The Replace dialog counts the avatar among the uses by address.
      const asked = await usageOf(editor, image.id, "?byAddress=true");
      expect(asked.items).toEqual([]);
      expect(asked.meta).toMatchObject({
        heldByAddress: 1,
        usageRecorded: true,
      });

      expect(await oldFileServedAfterReplace(image.id)).toBe(true);
    });

    it("keeps the old file for an image used only as the site's logo", async () => {
      const image = await looseImage();
      await t
        .getService("generalSettingsService")
        .updateSettings({ logoUrl: `https://site.test${image.url}` });
      try {
        expect(
          (await usageOf(editor, image.id, "?byAddress=true")).meta
        ).toMatchObject({ heldByAddress: 1 });
        expect(await oldFileServedAfterReplace(image.id)).toBe(true);
      } finally {
        await t.adapter.update(
          "site_settings",
          { logoUrl: null },
          { and: [{ column: "id", op: "IS NOT NULL" }] }
        );
      }
    });

    it("removes the old file of an image nothing names by address", async () => {
      // POSITIVE CONTROL for the two above: the same Replace, with no
      // avatar or logo, does remove the old file.
      const image = await looseImage();
      expect(
        (await usageOf(editor, image.id, "?byAddress=true")).meta
      ).toMatchObject({ heldByAddress: 0, usageRecorded: true });
      expect(await oldFileServedAfterReplace(image.id)).toBe(false);
    });

    it("keeps the old file while a JSON value names the item by its address", async () => {
      const image = await looseImage();
      const reader = await keyWith(t, [
        "read-media",
        "update-media",
        "read-replaceposts",
      ]);
      const oldPath = String((await row(image.id))!.filename);
      await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "replaceposts", overrideAccess: true },
          { title: "Settings", extra: { hero: { src: image.url } } }
        );
      // The use is recorded as one by address, from the reference itself.
      const asked = await usageOf(reader, image.id, "?byAddress=true");
      expect((asked.items as Doc[]).map(item => item.slug)).toEqual([
        "replaceposts",
      ]);

      expect(await oldFileServedAfterReplace(image.id)).toBe(true);
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);
    });

    /** A block document listing `listed` by id, its node showing `src`. */
    function blockDocument(listed: string, src?: string): Doc {
      return {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: randomUUID(),
            type: "core/image",
            props: { image: listed, ...(src ? { poster: { src } } : {}) },
          },
        ],
        assets: { mediaIds: [listed] },
      };
    }

    it("keeps the old file while a block document with its own list names the item by its address", async () => {
      const image = await looseImage();
      const oldPath = String((await row(image.id))!.filename);
      await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "replaceposts", overrideAccess: true },
          { title: "Page", extra: blockDocument(image.id, image.url) }
        );
      // The field's use is recorded as one by address, the node's, though the
      // list names the item by id too.
      const rows = await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {
        where: { and: [{ column: "mediaId", op: "=", value: image.id }] },
      });
      expect(rows.map(r => r.address)).toEqual([image.url]);

      expect(await oldFileServedAfterReplace(image.id)).toBe(true);
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);
    });

    it("removes the old file of an item a block document only lists by id", async () => {
      // POSITIVE CONTROL for the one above: the same document without the
      // address shows whatever file the item has, so the old file goes.
      const image = await looseImage();
      await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "replaceposts", overrideAccess: true },
          { title: "Page", extra: blockDocument(image.id) }
        );
      expect(await oldFileServedAfterReplace(image.id)).toBe(false);
    });

    it("still counts a use by the old address once its document is saved again unchanged", async () => {
      const image = await looseImage();
      const reader = await keyWith(t, [
        "read-media",
        "update-media",
        "read-replaceposts",
      ]);
      const handler = t.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "replaceposts", overrideAccess: true },
        { title: "Story", body: imageText(image.url) }
      );
      const storyId = String((created.data as { id?: unknown }).id);
      expect(await oldFileServedAfterReplace(image.id)).toBe(true);

      // Saved again, still naming the old address.
      await handler.updateEntry(
        {
          collectionName: "replaceposts",
          entryId: storyId,
          overrideAccess: true,
        },
        { title: "Story, edited" }
      );

      const used = (await usageOf(reader, image.id)).items as Array<{
        documentId: string;
        fields: Array<{ path: string; showsPreviousFile: boolean }>;
      }>;
      expect(used).toEqual([
        expect.objectContaining({
          documentId: storyId,
          fields: [
            expect.objectContaining({ path: "body", showsPreviousFile: true }),
          ],
        }),
      ]);
      const unused = await createMediaHandlers({ requireAuth: true }).GET(
        new Request("http://localhost/admin/api/media?limit=100&view=unused", {
          headers: { authorization: `Bearer ${reader}` },
        }),
        { params: Promise.resolve({ path: [] }) }
      );
      const unusedIds = (((await unused.json()) as Doc).items as Doc[]).map(
        item => item.id
      );
      expect(unusedIds).not.toContain(image.id);
      // POSITIVE CONTROL: the view lists an item nothing uses.
      const loose = await looseImage();
      const again = await createMediaHandlers({ requireAuth: true }).GET(
        new Request("http://localhost/admin/api/media?limit=100&view=unused", {
          headers: { authorization: `Bearer ${reader}` },
        }),
        { params: Promise.resolve({ path: [] }) }
      );
      expect(
        (((await again.json()) as Doc).items as Doc[]).map(item => item.id)
      ).toContain(loose.id);
    });

    /**
     * `read()`, with a rebuild finishing just after it first reads the
     * record's mark: the mark is written anew before anything else is read.
     */
    async function withRebuildAfterFirstMarkRead<T>(
      read: () => Promise<T>
    ): Promise<T> {
      const meta = t.getService("metaService");
      const original = t.adapter.select.bind(t.adapter);
      let flipped = false;
      // The executor is passed on: a transaction's own select comes through
      // here with its connection, and must stay on it.
      t.adapter.select = (async (
        table: string,
        options?: Parameters<typeof original>[1],
        executor?: Parameters<typeof original>[2]
      ) => {
        const rows = await original(table, options, executor);
        if (
          !flipped &&
          table === "nextly_meta" &&
          JSON.stringify(options).includes(MEDIA_USAGE_RECORDED_KEY)
        ) {
          flipped = true;
          await meta.set(MEDIA_USAGE_RECORDED_KEY, {
            rebuiltAt: new Date(Date.now() + 1_000).toISOString(),
          });
        }
        return rows;
      }) as typeof t.adapter.select;
      try {
        return await read();
      } finally {
        t.adapter.select = original;
        expect(flipped).toBe(true);
      }
    }

    it("says the usage record is unbuilt when a rebuild finishes while the uses are read", async () => {
      const image = await looseImage();
      const answer = await withRebuildAfterFirstMarkRead(() =>
        usageOf(editor, image.id)
      );

      expect(answer.meta).toMatchObject({ usageRecorded: false });
      // POSITIVE CONTROL: with no rebuild meanwhile, the record reads as built.
      expect((await usageOf(editor, image.id)).meta).toMatchObject({
        usageRecorded: true,
      });
    });

    // Replace reads which uses name the item by address, and whether the
    // record holding them was built, in one read: a rebuild finishing between
    // two separate reads could clear the rows of a record still marked built.
    it("keeps the old file when a rebuild finishes while Replace reads the uses", async () => {
      const image = await looseImage();
      const oldPath = String((await row(image.id))!.filename);

      const replaced = await withRebuildAfterFirstMarkRead(() =>
        replace(editor, image.id, {
          data: PNG_1X1,
          name: "after.png",
          type: "image/png",
        })
      );

      expect(replaced.status).toBe(200);
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);
      expect(
        (await readReplacedRecord(t.adapter, image.id))?.files
      ).toContainEqual({ path: oldPath, url: image.url });
      // POSITIVE CONTROL: with no rebuild meanwhile, the same Replace of an
      // item nothing names by address removes the old file.
      const loose = await looseImage();
      expect(await oldFileServedAfterReplace(loose.id)).toBe(false);
    });

    /**
     * `read()`, with every transaction opened after the one that points the
     * item at its new file failing, as a database lost just after that commit
     * would make them.
     */
    async function withWritesFailingAfterTheSwitch<T>(
      read: () => Promise<T>
    ): Promise<{ value: T; refused: number }> {
      const original = t.adapter.transaction.bind(t.adapter);
      let switched = false;
      let refused = 0;
      t.adapter.transaction = (async (
        work: Parameters<typeof original>[0],
        options?: Parameters<typeof original>[1]
      ) => {
        if (switched) {
          refused += 1;
          throw new Error("connection lost");
        }
        let switches = false;
        const result = await original(
          tx =>
            work(
              new Proxy(tx, {
                get(target, property, receiver) {
                  const value: unknown = Reflect.get(
                    target,
                    property,
                    receiver
                  );
                  if (property !== "update" || typeof value !== "function") {
                    return typeof value === "function"
                      ? (value as (...args: unknown[]) => unknown).bind(target)
                      : value;
                  }
                  return (table: string, ...rest: unknown[]) => {
                    if (table === "media") switches = true;
                    return (value as (...args: unknown[]) => unknown).call(
                      target,
                      table,
                      ...rest
                    );
                  };
                },
              })
            ),
          options
        );
        if (switches) switched = true;
        return result;
      }) as typeof t.adapter.transaction;
      try {
        return { value: await read(), refused };
      } finally {
        t.adapter.transaction = original;
      }
    }

    // Once the item points at its new file, the Replace has happened: what
    // follows it is bookkeeping, and its failure is logged, never answered
    // as the Replace failing (which would have the person try again).
    it("answers a committed Replace as done, with its kept files recorded, though the database fails just after", async () => {
      const image = await looseImage();
      const oldPath = String((await row(image.id))!.filename);
      await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "replaceposts", overrideAccess: true },
          { title: "Story", body: imageText(image.url) }
        );

      const { value: replaced } = await withWritesFailingAfterTheSwitch(() =>
        replace(editor, image.id, {
          data: PNG_1X1,
          name: "after.png",
          type: "image/png",
        })
      );

      expect(replaced.status).toBe(200);
      expect((await row(image.id))!.filename).not.toBe(oldPath);
      // Recorded with the switch itself, so the kept file is known as the
      // item's and goes when the item does.
      expect(
        (await readReplacedRecord(t.adapter, image.id))?.files
      ).toContainEqual({ path: oldPath, url: image.url });
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);
    });

    it("keeps the old file, still recorded, when the database fails just after a Replace that would remove it", async () => {
      const image = await looseImage();
      const oldPath = String((await row(image.id))!.filename);

      const { value: replaced, refused } =
        await withWritesFailingAfterTheSwitch(() =>
          replace(editor, image.id, {
            data: PNG_1X1,
            name: "after.png",
            type: "image/png",
          })
        );

      expect(replaced.status).toBe(200);
      expect(refused).toBeGreaterThan(0);
      // The record could not be taken back, so the file it names stays: a
      // file kept is one the item's delete still removes.
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);
      expect(
        (await readReplacedRecord(t.adapter, image.id))?.files
      ).toContainEqual({ path: oldPath, url: image.url });
    });

    it("says on every usage answer whether the usage record is built", async () => {
      const image = await looseImage();
      expect((await usageOf(editor, image.id)).meta).toMatchObject({
        usageRecorded: true,
      });
      const meta = t.getService("metaService");
      await meta.delete(MEDIA_USAGE_RECORDED_KEY);
      try {
        expect((await usageOf(editor, image.id)).meta).toMatchObject({
          usageRecorded: false,
        });
      } finally {
        await meta.set(MEDIA_USAGE_RECORDED_KEY, {
          rebuiltAt: new Date().toISOString(),
        });
      }
    });

    it("keeps the old file when a field names both the current and a kept address, and says it shows the previous file", async () => {
      const image = await looseImage();
      const reader = await keyWith(t, [
        "read-media",
        "update-media",
        "read-replaceposts",
      ]);
      const handler = t.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "replaceposts", overrideAccess: true },
        { title: "Both", body: imageText(image.url) }
      );
      const storyId = String((created.data as { id?: unknown }).id);
      expect(await oldFileServedAfterReplace(image.id)).toBe(true);
      const now = String((await row(image.id))!.url);

      // One field, one language: the old address and the new one.
      await handler.updateEntry(
        {
          collectionName: "replaceposts",
          entryId: storyId,
          overrideAccess: true,
        },
        {
          body: {
            root: {
              type: "root",
              version: 1,
              children: [
                { type: "image", version: 1, src: image.url, altText: "" },
                { type: "image", version: 1, src: now, altText: "" },
              ],
            },
          },
        }
      );

      const used = (await usageOf(reader, image.id)).items as Array<{
        fields: Array<{ path: string; showsPreviousFile: boolean }>;
      }>;
      expect(used.flatMap(use => use.fields)).toEqual([
        expect.objectContaining({ path: "body", showsPreviousFile: true }),
      ]);
    });

    it("reads a record marked before rows kept their address as still being built, until it is rebuilt", async () => {
      const meta = t.getService("metaService");
      const image = await looseImage();
      const handler = t.getService("collectionsHandler");
      await handler.createEntry(
        { collectionName: "replaceposts", overrideAccess: true },
        { title: "Legacy", body: imageText(image.url) }
      );
      // A record written before rows kept their address: its rows have
      // none, and it is marked complete under the earlier key.
      await t.adapter.update(
        MEDIA_USAGE_TABLE,
        { address: null },
        { and: [{ column: "mediaId", op: "=", value: image.id }] }
      );
      await meta.delete(MEDIA_USAGE_RECORDED_KEY);
      await meta.set("media.usage.recorded", {
        rebuiltAt: new Date().toISOString(),
      });
      const counts = async () => {
        const res = await createMediaHandlers({ requireAuth: true }).GET(
          new Request("http://localhost/admin/api/media/counts", {
            headers: { authorization: `Bearer ${editor}` },
          }),
          { params: Promise.resolve({ path: ["counts"] }) }
        );
        return (await res.json()) as Doc;
      };
      try {
        expect(await counts()).toMatchObject({ usageRecorded: false });
        expect((await usageOf(editor, image.id)).meta).toMatchObject({
          usageRecorded: false,
        });
        // The row says nothing of the address, so only the unbuilt record
        // keeps the old file.
        expect(await oldFileServedAfterReplace(image.id)).toBe(true);

        await reindexMediaUsage({
          adapter: t.adapter,
          collections: {
            slugs: async () => ["replaceposts"],
            rebuild: slug =>
              t.getService("collectionService").rebuildMediaUsage(slug),
          },
          singles: { slugs: async () => [], rebuild: async () => false },
          meta,
        });

        expect(await counts()).toMatchObject({ usageRecorded: true });
        const rows = await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {
          where: { and: [{ column: "mediaId", op: "=", value: image.id }] },
        });
        expect(rows.map(found => found.address)).toEqual([image.url]);
      } finally {
        await meta.delete("media.usage.recorded");
        await meta.set(MEDIA_USAGE_RECORDED_KEY, {
          rebuiltAt: new Date().toISOString(),
        });
      }
    });

    it("links an address an earlier Replace kept to its item when the record is rebuilt", async () => {
      const image = await looseImage();
      const handler = t.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "replaceposts", overrideAccess: true },
        { title: "Earlier", body: imageText(image.url) }
      );
      const storyId = String((created.data as { id?: unknown }).id);
      expect(await oldFileServedAfterReplace(image.id)).toBe(true);
      // A Replace made before kept addresses were indexed: its record of
      // kept files stands, the index of their addresses does not.
      await t.adapter.delete("nextly_meta", {
        and: [{ column: "key", op: "LIKE", value: "media.address:%" }],
      });

      await reindexMediaUsage({
        adapter: t.adapter,
        collections: {
          slugs: async () => ["replaceposts"],
          rebuild: slug =>
            t.getService("collectionService").rebuildMediaUsage(slug),
        },
        singles: { slugs: async () => [], rebuild: async () => false },
        meta: t.getService("metaService"),
      });

      const rows = await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {
        where: { and: [{ column: "mediaId", op: "=", value: image.id }] },
      });
      expect(rows.map(found => [found.documentId, found.address])).toEqual([
        [storyId, image.url],
      ]);
    });

    it("keeps the old file, and records it kept, while the usage record is still being built", async () => {
      const image = await looseImage();
      const meta = t.getService("metaService");
      await meta.delete(MEDIA_USAGE_RECORDED_KEY);
      try {
        expect(
          (await usageOf(editor, image.id, "?byAddress=true")).meta
        ).toMatchObject({ heldByAddress: 0, usageRecorded: false });
        const oldPath = String((await row(image.id))!.filename);
        expect(await oldFileServedAfterReplace(image.id)).toBe(true);
        // Recorded as kept, so deleting the item takes the file with it.
        expect(
          (await readReplacedRecord(t.adapter, image.id))?.files
        ).toContainEqual(expect.objectContaining({ path: oldPath }));
      } finally {
        await meta.set(MEDIA_USAGE_RECORDED_KEY, {
          rebuiltAt: new Date().toISOString(),
        });
      }
    });

    it("removes the kept file when a deleted item's window ends", async () => {
      const logo = await usedLogo();
      const oldPath = String((await row(logo.id))!.filename);
      const handler = t.getService("collectionsHandler");
      await handler.createEntry(
        { collectionName: "replaceposts", overrideAccess: true },
        { title: "Kept", body: imageText(String((await row(logo.id))!.url)) }
      );
      expect(
        (
          await replace(editor, logo.id, {
            data: PNG_1X1,
            name: "again.png",
            type: "image/png",
          })
        ).status
      ).toBe(200);
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(true);

      const finaliser = (later: number) =>
        new PendingMediaDeletes({
          db: t.adapter,
          deleteItem: async id => {
            await t.getService("mediaService").delete(id, {});
          },
          now: () => new Date(Date.now() + later),
        });
      // Deleted now, finished once the window has passed.
      await finaliser(0).mark([logo.id]);
      expect(
        await finaliser(PENDING_DELETE_WINDOW_MS + 1_000).finalizeDue()
      ).toEqual([logo.id]);
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(false);
    });
  }
);
