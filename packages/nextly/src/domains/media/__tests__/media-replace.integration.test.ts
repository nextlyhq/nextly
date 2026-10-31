/**
 * Replacing a media item's file keeps the item, on every dialect, over the
 * admin's media route: the same id, name, alt text, caption, folder and
 * usage; a new address and thumbnail; a document using the item resolves to
 * the new file; the old files go and the new ones stay. A file the upload
 * checks refuse is refused here too, leaving the item as it was.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaHandlers } from "../../../api/media-handlers";
import { defineCollection, richText, text, upload } from "../../../config";
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
import { removeKeptFiles } from "../usage/address-uses";

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
            ],
          }),
        ],
      });
      editor = await keyWith(t, ["read-media", "update-media"]);
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
      await removeKeptFiles(
        t.adapter,
        getMediaStorage(),
        t.getService("logger"),
        logo.id
      );
      expect(await getMediaStorage().exists(oldPath, "media")).toBe(false);
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
          afterDelete: id =>
            removeKeptFiles(
              t.adapter,
              getMediaStorage(),
              t.getService("logger"),
              id
            ),
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
