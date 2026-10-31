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
import { defineCollection, text, upload } from "../../../config";
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
  }
);
