/**
 * A media delete that can be undone, on every dialect, over the admin's
 * media routes:
 *
 * - a deleted item leaves every library read at once (the list, a folder, a
 *   search, both views) and every count beside them, which keep agreeing
 *   with the lists;
 * - Undo brings it back whole: the same row, its files, its folder and its
 *   usage;
 * - once the window has passed it is deleted with its files, by any instance,
 *   a fresh one included, and by the next library read;
 * - Undo racing the finaliser, and two finalisers, each settle on exactly
 *   one outcome, and an undone item is never deleted later;
 * - both halves need the delete permission, checked before any mark is
 *   written.
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
  PNG_1X1,
  pdfDocument,
} from "../../../services/upload-validation/__tests__/format-fixtures";
import { getMediaStorage } from "../../../storage/storage";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";
import {
  PENDING_DELETE_WINDOW_MS,
  PendingMediaDeletes,
  pendingDeleteKey,
} from "../pending-delete";

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
  const slug = `pending-${randomUUID().slice(0, 8)}`;
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

/** One call to the admin's media routes as the holder of `key`. */
async function api(
  key: string,
  method: "GET" | "POST",
  path: string[],
  options: { query?: string; body?: unknown } = {}
): Promise<{ status: number; json: Doc }> {
  const handlers = createMediaHandlers({ requireAuth: true });
  const res = await handlers[method](
    new Request(
      `http://localhost/admin/api/media/${path.join("/")}${options.query ?? ""}`,
      {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      }
    ),
    { params: Promise.resolve({ path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

describe.each(getConfiguredTestDialects())(
  "a media delete that can be undone (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let editor: string;
    let folderId: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "pendingposts",
            fields: [
              text({ name: "title" }),
              upload({ name: "cover", relationTo: "media" }),
            ],
          }),
        ],
      });
      editor = await keyWith(t, ["read-media", "delete-media"]);
      folderId = randomUUID();
      await t.adapter.insert("media_folders", {
        id: folderId,
        name: "Kept",
        createdBy: await seedPlainAuthor(t),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** A fresh image with no alt text, in the folder, used by a post. */
    async function usedImage(): Promise<{ id: string; postId: string }> {
      const uploaded = await t.nextly.media.upload({
        file: {
          data: PNG_1X1,
          name: `pending-${randomUUID().slice(0, 6)}.png`,
          mimetype: "image/png",
          size: PNG_1X1.length,
        },
        folder: folderId,
      });
      const created = await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "pendingposts", overrideAccess: true },
          { title: "Uses it", cover: uploaded.id }
        );
      return {
        id: uploaded.id,
        postId: String((created.data as { id?: unknown }).id),
      };
    }

    /** A fresh document nothing uses, in no folder. */
    async function unusedFile(): Promise<string> {
      const data = pdfDocument(randomUUID());
      const uploaded = await t.nextly.media.upload({
        file: {
          data,
          name: `pending-${randomUUID().slice(0, 6)}.pdf`,
          mimetype: "application/pdf",
          size: data.length,
        },
      });
      return uploaded.id;
    }

    async function row(id: string): Promise<Doc | undefined> {
      const rows = await t.adapter.select<Doc>("media", {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      return rows[0];
    }

    async function usageRows(id: string): Promise<number> {
      const rows = await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {
        where: { and: [{ column: "mediaId", op: "=", value: id }] },
      });
      return rows.length;
    }

    async function filesOf(id: string): Promise<boolean[]> {
      const found = await row(id);
      const paths = [found?.filename].filter(
        (path): path is string => typeof path === "string"
      );
      return Promise.all(
        paths.map(path => getMediaStorage().exists(path, "media"))
      );
    }

    /** What every library read says, as the ids each lists and each count. */
    async function libraryView(): Promise<{
      list: string[];
      folder: string[];
      missingAlt: string[];
      unused: string[];
      search: string[];
      counts: Doc;
      totals: Record<string, number>;
    }> {
      const ids = (r: { json: Doc }) =>
        ((r.json.items ?? (r.json.files as Doc[])) as Doc[]).map(item =>
          String(item.id)
        );
      const total = (r: { json: Doc }) =>
        Number((r.json.meta as { total: number }).total);
      const list = await api(editor, "GET", [], { query: "?limit=100" });
      const folder = await api(
        editor,
        "GET",
        ["folders", folderId, "contents"],
        {
          query: "?limit=100",
        }
      );
      const missingAlt = await api(editor, "GET", [], {
        query: "?limit=100&view=missing-alt",
      });
      const unused = await api(editor, "GET", [], {
        query: "?limit=100&view=unused",
      });
      const search = await api(editor, "GET", [], {
        query: "?limit=100&search=pending-",
      });
      const counts = await api(editor, "GET", ["counts"]);
      return {
        list: ids(list),
        folder: ids(folder),
        missingAlt: ids(missingAlt),
        unused: ids(unused),
        search: ids(search),
        counts: counts.json,
        totals: {
          list: total(list),
          folder: total(folder),
          missingAlt: total(missingAlt),
          unused: total(unused),
        },
      };
    }

    /** A finaliser on its own, as a fresh process would build one. */
    function freshFinaliser(
      laterBy = PENDING_DELETE_WINDOW_MS + 1_000,
      onDelete: (id: string) => void = () => undefined
    ): PendingMediaDeletes {
      return new PendingMediaDeletes({
        db: t.adapter,
        deleteItem: async (id, actor) => {
          onDelete(id);
          await t.getService("mediaService").delete(id, {}, actor);
        },
        now: () => new Date(Date.now() + laterBy),
      });
    }

    it("takes a deleted item out of every library read and count at once, and the counts agree with the lists", async () => {
      const image = await usedImage();
      const file = await unusedFile();
      const before = await libraryView();
      expect(before.list).toEqual(expect.arrayContaining([image.id, file]));
      expect(before.folder).toContain(image.id);
      expect(before.missingAlt).toContain(image.id);
      expect(before.unused).toContain(file);
      expect(before.search).toEqual(expect.arrayContaining([image.id, file]));

      const deleted = await api(editor, "POST", ["deletions"], {
        body: { ids: [image.id, file] },
      });
      expect(deleted.status).toBe(200);
      expect(deleted.json.ids).toEqual([image.id, file]);

      const after = await libraryView();
      for (const read of [
        after.list,
        after.folder,
        after.missingAlt,
        after.unused,
        after.search,
      ]) {
        expect(read).not.toContain(image.id);
        expect(read).not.toContain(file);
      }
      // Each count is the size of the list it stands for.
      expect(after.counts.all).toBe(after.totals.list);
      expect(after.counts.missingAltText).toBe(after.totals.missingAlt);
      expect(after.counts.unused).toBe(after.totals.unused);
      // A folder with nothing in it has no count, which reads as none.
      expect(
        (after.counts.folders as Record<string, number>)[folderId] ?? 0
      ).toBe(after.totals.folder);
      expect(after.totals.list).toBe(before.totals.list - 2);

      // The rows and files are still there, waiting for the window.
      expect(await row(image.id)).toBeDefined();
      expect(await filesOf(image.id)).toEqual([true]);
      await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: [image.id, file] },
      });
    });

    it("brings an undone item back unchanged, in its folder, with its usage and its files", async () => {
      const image = await usedImage();
      const rowBefore = await row(image.id);
      expect(await usageRows(image.id)).toBe(1);

      await api(editor, "POST", ["deletions"], { body: { ids: [image.id] } });
      const undone = await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: [image.id] },
      });

      expect(undone.status).toBe(200);
      expect(undone.json).toMatchObject({ restored: [image.id], gone: [] });
      expect(await row(image.id)).toEqual(rowBefore);
      expect(await usageRows(image.id)).toBe(1);
      expect(await filesOf(image.id)).toEqual([true]);
      expect((await libraryView()).folder).toContain(image.id);
      // An undone item is never deleted later, by anything.
      expect(await freshFinaliser().finalizeDue()).not.toContain(image.id);
      expect(await row(image.id)).toBeDefined();
    });

    it("deletes the item and its files once the window has passed, from a fresh instance", async () => {
      const image = await usedImage();
      const filename = String((await row(image.id))?.filename);
      await api(editor, "POST", ["deletions"], { body: { ids: [image.id] } });

      // Inside the window nothing is due.
      expect(await freshFinaliser(0).finalizeDue()).toEqual([]);
      expect(await row(image.id)).toBeDefined();

      expect(await freshFinaliser().finalizeDue()).toEqual([image.id]);
      expect(await row(image.id)).toBeUndefined();
      expect(await getMediaStorage().exists(filename, "media")).toBe(false);
      expect(await usageRows(image.id)).toBe(0);

      // Undo after the window says the item is gone.
      const late = await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: [image.id] },
      });
      expect(late.json).toMatchObject({ restored: [], gone: [image.id] });
    });

    it("lets the next library read finish a delete whose window ended", async () => {
      const file = await unusedFile();
      // A mark written before the window, as a process that died mid-window
      // leaves it.
      await t.adapter.insert("nextly_meta", {
        key: pendingDeleteKey(file),
        value: JSON.stringify({}),
        updated_at: new Date(Date.now() - PENDING_DELETE_WINDOW_MS - 5_000),
      });
      expect(await row(file)).toBeDefined();

      const read = await api(editor, "GET", [], { query: "?limit=100" });

      expect(read.status).toBe(200);
      expect(await row(file)).toBeUndefined();
    });

    it("settles Undo racing the finaliser on exactly one outcome", async () => {
      for (let round = 0; round < 4; round += 1) {
        const file = await unusedFile();
        await api(editor, "POST", ["deletions"], { body: { ids: [file] } });
        const [undone, finalised] = await Promise.all([
          api(editor, "POST", ["deletions", "undo"], { body: { ids: [file] } }),
          freshFinaliser().finalizeDue(),
        ]);
        const restored = (undone.json.restored as string[]).includes(file);
        const deleted = finalised.includes(file);
        // One of them took the mark, never both and never neither.
        expect(restored).not.toBe(deleted);
        expect(Boolean(await row(file))).toBe(restored);
      }
    });

    it("deletes once however many finalisers run", async () => {
      const file = await unusedFile();
      await api(editor, "POST", ["deletions"], { body: { ids: [file] } });
      const deletes: string[] = [];
      const record = (id: string) => deletes.push(id);

      const answers = await Promise.all([
        freshFinaliser(undefined, record).finalizeDue(),
        freshFinaliser(undefined, record).finalizeDue(),
      ]);
      const again = await freshFinaliser(undefined, record).finalizeDue();

      expect(answers.flat().filter(id => id === file)).toEqual([file]);
      expect(again).toEqual([]);
      expect(deletes.filter(id => id === file)).toEqual([file]);
      expect(await row(file)).toBeUndefined();
    });

    it("refuses a delete or an Undo without the delete permission, before writing anything", async () => {
      const reader = await keyWith(t, ["read-media"]);
      const file = await unusedFile();

      const refused = await api(reader, "POST", ["deletions"], {
        body: { ids: [file] },
      });
      expect(refused.status).toBe(403);
      const marks = await t.adapter.select<Doc>("nextly_meta", {
        where: {
          and: [{ column: "key", op: "=", value: pendingDeleteKey(file) }],
        },
      });
      expect(marks).toEqual([]);

      await api(editor, "POST", ["deletions"], { body: { ids: [file] } });
      const undoRefused = await api(reader, "POST", ["deletions", "undo"], {
        body: { ids: [file] },
      });
      expect(undoRefused.status).toBe(403);
      // Still deleted: the refused Undo removed no mark.
      expect(
        (await api(editor, "GET", [], { query: "?limit=100" })).json.items
      ).not.toContainEqual(expect.objectContaining({ id: file }));
    });

    it("refuses a delete naming an item that does not exist, marking none", async () => {
      const file = await unusedFile();
      const missing = randomUUID();
      const refused = await api(editor, "POST", ["deletions"], {
        body: { ids: [file, missing] },
      });
      expect(refused.status).toBe(404);
      expect(
        (await api(editor, "GET", [], { query: "?limit=100" })).json.items
      ).toContainEqual(expect.objectContaining({ id: file }));
    });
  }
);
