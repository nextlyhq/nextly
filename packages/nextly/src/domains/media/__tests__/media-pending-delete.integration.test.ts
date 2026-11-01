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
 * - Undo after the deadline is refused even before anything has finished
 *   the delete, and the finaliser then deletes the item;
 * - a batch is marked whole or not at all;
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
import { container } from "../../../di/container";
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
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobNow } from "../../jobs/jobs-runner";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";
import { MEDIA_FINALIZE_DELETES_JOB } from "../finalize-deletes-job";
import {
  PENDING_DELETE_WINDOW_MS,
  PendingMediaDeletes,
  pendingDeleteKey,
  type PendingDeleteDb,
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
  method: "GET" | "POST" | "DELETE",
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

    // First, so no other delete's timer runs while this one is waited for.
    it("finishes every item of a delete larger than one sweep from that delete's own timer, rows and files", async () => {
      const files: Array<{ id: string; filename: string }> = [];
      for (let made = 0; made < 60; made += 1) {
        const id = await unusedFile();
        files.push({ id, filename: String((await row(id))?.filename) });
      }
      const ids = files.map(file => file.id);
      const deleted = await api(editor, "POST", ["deletions"], {
        body: { ids },
      });
      expect(deleted.status).toBe(200);

      // No library read runs meanwhile: only the delete's timer finishes it.
      const left = async () =>
        (
          await t.adapter.select<Doc>("media", {
            columns: ["id"],
            where: { and: [{ column: "id", op: "IN", value: ids }] },
          })
        ).length;
      await expect
        .poll(left, {
          timeout: PENDING_DELETE_WINDOW_MS + 15_000,
          interval: 500,
        })
        .toBe(0);
      const stored = await Promise.all(
        files.map(file => getMediaStorage().exists(file.filename, "media"))
      );
      expect(stored.filter(Boolean)).toEqual([]);
    }, 90_000);

    // The worker that took a delete can be gone before its window ends (a
    // serverless function, a restart), and no one may read the library
    // after. The job the delete queued finishes it on the next jobs run.
    it("finishes a delete through the job it queued, with no timer and no library read", async () => {
      const image = await usedImage();
      const filename = String((await row(image.id))?.filename);
      const deleted = await api(editor, "POST", ["deletions"], {
        body: { ids: [image.id] },
      });
      expect(deleted.status).toBe(200);
      const deadline = Date.parse(String(deleted.json.markedDeleteAfter));

      // The job, queued with the mark, to run at the window's end.
      const jobs = (
        await t.adapter.select<Doc>("nextly_jobs", {
          where: {
            and: [
              {
                column: "slug",
                op: "=",
                value: MEDIA_FINALIZE_DELETES_JOB,
              },
            ],
          },
        })
      ).filter(job =>
        (typeof job.input === "string"
          ? job.input
          : JSON.stringify(job.input)
        ).includes(image.id)
      );
      expect(jobs).toHaveLength(1);
      const jobId = String(jobs[0]!.id);
      const registry = container.get<JobRegistry>("jobRegistry");

      // Before the deadline the job is not due, and the item stays.
      const early = await runJobNow(t.adapter, registry, jobId, {
        now: () => new Date(deadline - 2_000),
      });
      expect(early.claimed).toBe(0);
      expect(await row(image.id)).toBeDefined();

      // A run after it finishes the delete: the row, its files and its usage.
      const run = await runJobNow(t.adapter, registry, jobId, {
        now: () => new Date(deadline + 1_000),
      });
      expect(run.claimed).toBe(1);
      expect(await row(image.id)).toBeUndefined();
      expect(await getMediaStorage().exists(filename, "media")).toBe(false);
      expect(await usageRows(image.id)).toBe(0);
      const [settled] = await t.adapter.select<Doc>("nextly_jobs", {
        where: { and: [{ column: "id", op: "=", value: jobId }] },
      });
      expect(settled?.state).toBe("done");
    });

    it("lets the job of a delete that was undone finish nothing", async () => {
      const file = await unusedFile();
      const deleted = await api(editor, "POST", ["deletions"], {
        body: { ids: [file] },
      });
      await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: [file] },
      });
      const deadline = Date.parse(String(deleted.json.markedDeleteAfter));
      const job = (
        await t.adapter.select<Doc>("nextly_jobs", {
          where: {
            and: [
              {
                column: "slug",
                op: "=",
                value: MEDIA_FINALIZE_DELETES_JOB,
              },
            ],
          },
        })
      ).find(found =>
        (typeof found.input === "string"
          ? found.input
          : JSON.stringify(found.input)
        ).includes(file)
      );

      const run = await runJobNow(
        t.adapter,
        container.get<JobRegistry>("jobRegistry"),
        String(job?.id),
        { now: () => new Date(deadline + 1_000) }
      );

      expect(run.claimed).toBe(1);
      expect(await row(file)).toBeDefined();
    });

    it("finishes a delete of an item already marked by that mark's deadline, not a fresh window", async () => {
      const file = await unusedFile();
      // Marked by a delete whose timer went with its process, nine seconds
      // into its window.
      await t.adapter.insert("nextly_meta", {
        key: pendingDeleteKey(file),
        value: JSON.stringify({}),
        updated_at: new Date(Date.now() - PENDING_DELETE_WINDOW_MS + 1_000),
      });

      const deleted = await api(editor, "POST", ["deletions"], {
        body: { ids: [file] },
      });
      expect(deleted.status).toBe(200);

      // Well before a fresh window could end, with no library read.
      await expect
        .poll(async () => Boolean(await row(file)), {
          timeout: 5_000,
          interval: 250,
        })
        .toBe(false);
      // The answer said this delete marked nothing itself.
      expect(deleted.json).toMatchObject({ ids: [file], marked: [] });
    }, 30_000);

    it("finishes an item marked later than the earliest at its own deadline", async () => {
      const standing = await unusedFile();
      const fresh = await unusedFile();
      // One item marked nine seconds into its window, by a delete whose
      // timer went with its process.
      await t.adapter.insert("nextly_meta", {
        key: pendingDeleteKey(standing),
        value: JSON.stringify({}),
        updated_at: new Date(Date.now() - PENDING_DELETE_WINDOW_MS + 1_000),
      });

      // Answered with the earlier deadline; the fresh item is due later.
      const deleted = await api(editor, "POST", ["deletions"], {
        body: { ids: [standing, fresh] },
      });
      expect(deleted.status).toBe(200);

      // No library read: only the delete's timers finish them.
      await expect
        .poll(async () => Boolean(await row(standing)), {
          timeout: 5_000,
          interval: 250,
        })
        .toBe(false);
      await expect
        .poll(async () => Boolean(await row(fresh)), {
          timeout: PENDING_DELETE_WINDOW_MS + 6_000,
          interval: 500,
        })
        .toBe(false);
    }, 45_000);

    it("says which items a delete marked itself", async () => {
      const files = [await unusedFile(), await unusedFile()];
      const first = await api(editor, "POST", ["deletions"], {
        body: { ids: [files[0]] },
      });
      const second = await api(editor, "POST", ["deletions"], {
        body: { ids: files },
      });
      expect(first.json).toMatchObject({ marked: [files[0]] });
      expect(second.json).toMatchObject({ ids: files, marked: [files[1]] });
      // And when those go, apart from any an earlier delete marked.
      expect(typeof second.json.markedDeleteAfter).toBe("string");
      await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: files },
      });
    });

    it("answers a delete of an item already marked with the standing mark's deadline", async () => {
      const file = await unusedFile();
      // Whole seconds, which every dialect stores a mark's time in.
      const first = new Date(Math.floor(Date.now() / 1000) * 1000);
      const at = (time: Date) =>
        new PendingMediaDeletes({
          db: t.adapter,
          deleteItem: async () => undefined,
          now: () => time,
        });

      const marked = await at(first).mark([file]);
      const again = await at(new Date(first.getTime() + 5_000)).mark([file]);

      const deadline = new Date(
        first.getTime() + PENDING_DELETE_WINDOW_MS
      ).toISOString();
      expect(marked.deleteAfter).toBe(deadline);
      expect(again.deleteAfter).toBe(deadline);
      await at(first).undo([file]);
    });

    it("answers when this delete's own items go, apart from an item an earlier delete marked", async () => {
      const [standing, fresh] = [await unusedFile(), await unusedFile()];
      // Whole seconds, which every dialect stores a mark's time in.
      const first = new Date(Math.floor(Date.now() / 1000) * 1000);
      const later = new Date(first.getTime() + 5_000);
      const at = (time: Date) =>
        new PendingMediaDeletes({
          db: t.adapter,
          deleteItem: async () => undefined,
          now: () => time,
        });
      const after = (time: Date) =>
        new Date(time.getTime() + PENDING_DELETE_WINDOW_MS).toISOString();

      await at(first).mark([standing]);
      const both = await at(later).mark([standing, fresh]);
      const neither = await at(later).mark([standing, fresh]);

      expect(both.marked).toEqual([fresh]);
      // The whole request's earliest deadline is the standing mark's...
      expect(both.deleteAfter).toBe(after(first));
      // ...and this delete's own item goes a full window after it.
      expect(both.markedDeleteAfter).toBe(after(later));
      // A delete that marked nothing itself has no deadline of its own.
      expect(neither).toMatchObject({ marked: [], markedDeleteAfter: null });
      await at(later).undo([standing, fresh]);
    });

    it("undoes each item still inside its own window and says which had gone, when a batch's deadlines differ", async () => {
      const [early, late] = [await unusedFile(), await unusedFile()];
      const first = new Date(Math.floor(Date.now() / 1000) * 1000);
      const later = new Date(first.getTime() + 5_000);
      const at = (time: Date) =>
        new PendingMediaDeletes({
          db: t.adapter,
          deleteItem: async () => undefined,
          now: () => time,
        });
      await at(first).mark([early]);
      await at(later).mark([late]);

      // One Undo, after the first window and inside the second.
      const undone = await at(
        new Date(first.getTime() + PENDING_DELETE_WINDOW_MS + 1_000)
      ).undo([early, late]);

      // Not all or none: the one still inside its window comes back.
      expect(undone).toEqual({ restored: [late], gone: [early] });
      const marks = await t.adapter.select<Doc>("nextly_meta", {
        where: {
          and: [
            {
              column: "key",
              op: "IN",
              value: [early, late].map(pendingDeleteKey),
            },
          ],
        },
      });
      expect(marks.map(mark => mark.key)).toEqual([pendingDeleteKey(early)]);
      // The first item's mark stays for the finaliser; taken back here so no
      // later case finds it due.
      await at(first).undo([early]);
    });

    it("undoes none of a batch when taking any one of its marks fails", async () => {
      const files = [
        await unusedFile(),
        await unusedFile(),
        await unusedFile(),
      ];
      await api(editor, "POST", ["deletions"], { body: { ids: files } });
      const failOn = pendingDeleteKey(files[2]!);
      type Where = Parameters<TestNextly["adapter"]["delete"]>[1];
      const names = (where: Where) =>
        JSON.stringify(where).includes(JSON.stringify(failOn));
      // The adapter, failing the third item's Undo whether it is taken on the
      // pool or inside a transaction.
      const failing = {
        select: t.adapter.select.bind(t.adapter),
        insert: t.adapter.insert.bind(t.adapter),
        delete: (table: string, where: Where) =>
          names(where)
            ? Promise.reject(new Error("the third Undo is refused"))
            : t.adapter.delete(table, where),
        transaction: (work: (tx: object) => Promise<unknown>) =>
          t.adapter.transaction(tx =>
            work(
              new Proxy(tx, {
                get(target, property, receiver) {
                  if (property === "delete") {
                    return (table: string, where: Where) =>
                      names(where)
                        ? Promise.reject(new Error("the third Undo is refused"))
                        : target.delete(table, where);
                  }
                  const value: unknown = Reflect.get(
                    target,
                    property,
                    receiver
                  );
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
              })
            )
          ),
      } as unknown as PendingDeleteDb;
      const pending = new PendingMediaDeletes({
        db: failing,
        deleteItem: async () => undefined,
      });

      await expect(pending.undo(files)).rejects.toThrow();

      // Every mark still stands, so none of the batch came back.
      const marks = await t.adapter.select<Doc>("nextly_meta", {
        where: {
          and: [
            { column: "key", op: "IN", value: files.map(pendingDeleteKey) },
          ],
        },
      });
      expect(marks).toHaveLength(3);
      // POSITIVE CONTROL: the same Undo, nothing failing, brings all back.
      const undone = await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: files },
      });
      expect(undone.json).toMatchObject({ restored: files, gone: [] });
    });

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

    it("refuses an Undo after the deadline though nothing has finished the delete, and the next finalise deletes the item", async () => {
      const file = await unusedFile();
      // Due, with no timer and no library read since to finish it.
      await t.adapter.insert("nextly_meta", {
        key: pendingDeleteKey(file),
        value: JSON.stringify({}),
        updated_at: new Date(Date.now() - PENDING_DELETE_WINDOW_MS - 5_000),
      });

      const late = await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: [file] },
      });

      expect(late.status).toBe(200);
      expect(late.json).toMatchObject({ restored: [], gone: [file] });
      // The mark stands for the finaliser, which owns the item now.
      const marks = await t.adapter.select<Doc>("nextly_meta", {
        where: {
          and: [{ column: "key", op: "=", value: pendingDeleteKey(file) }],
        },
      });
      expect(marks).toHaveLength(1);
      expect(await freshFinaliser(0).finalizeDue()).toContain(file);
      expect(await row(file)).toBeUndefined();
    });

    // An item inside its Undo window is hidden from the folder's listing but
    // is still in it: the folder is not empty, and deleting it must neither
    // move the item to the library root (its folder going) nor delete it
    // before its deadline (the folder's contents going).
    it("refuses to delete a folder holding an item inside its Undo window, with or without its contents", async () => {
      const own = randomUUID();
      await t.adapter.insert("media_folders", {
        id: own,
        name: "Waiting",
        createdBy: await seedPlainAuthor(t),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const file = await unusedFile();
      await t.adapter.update(
        "media",
        { folderId: own },
        { and: [{ column: "id", op: "=", value: file }] }
      );
      await api(editor, "POST", ["deletions"], { body: { ids: [file] } });
      // As the folder's listing shows it: empty.
      const listed = await api(editor, "GET", ["folders", own, "contents"]);
      expect(
        ((listed.json.items ?? listed.json.files) as Doc[]).map(i => i.id)
      ).toEqual([]);

      const alone = await api(editor, "DELETE", ["folders", own]);
      const withContents = await api(editor, "DELETE", ["folders", own], {
        query: "?deleteContents=true",
      });

      expect(alone.status).toBe(409);
      expect(withContents.status).toBe(409);
      const folders = await t.adapter.select<Doc>("media_folders", {
        where: { and: [{ column: "id", op: "=", value: own }] },
      });
      expect(folders).toHaveLength(1);
      expect(await row(file)).toMatchObject({ folderId: own });
      // Undo brings it back where it was.
      const undone = await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: [file] },
      });
      expect(undone.json).toMatchObject({ restored: [file] });
      expect(await row(file)).toMatchObject({ folderId: own });

      // POSITIVE CONTROL: once its item has gone, the folder deletes.
      await api(editor, "POST", ["deletions"], { body: { ids: [file] } });
      await freshFinaliser().finalizeMarked([file]);
      expect(await row(file)).toBeUndefined();
      expect((await api(editor, "DELETE", ["folders", own])).status).toBe(200);
    });

    // MySQL and SQLite keep a mark's time to the second. The deadline a
    // delete answers is the one the stored mark gives, so Undo is never
    // refused before it; a time kept from the unstored instant could be up to
    // a second later than the database's.
    it("answers the deadline the stored mark gives, never later, whatever the database's precision", async () => {
      const file = await unusedFile();
      // Late in a second, as most deletes are.
      const base = Math.floor(Date.now() / 1_000) * 1_000 + 400;
      let clock = base;
      const deletes = new PendingMediaDeletes({
        db: t.adapter,
        deleteItem: async (id, actor) => {
          await t.getService("mediaService").delete(id, {}, actor);
        },
        now: () => new Date(clock),
      });

      const marked = await deletes.mark([file]);
      const deadline = Date.parse(String(marked.markedDeleteAfter));
      expect(Date.parse(marked.deleteAfter)).toBe(deadline);

      // Just before the answered deadline, Undo still brings it back.
      clock = deadline - 50;
      expect(await deletes.undo([file])).toEqual({
        restored: [file],
        gone: [],
      });

      // POSITIVE CONTROL: just after it, Undo is refused, so the answered
      // deadline is not a later one either.
      clock = base;
      const again = await deletes.mark([file]);
      clock = Date.parse(String(again.markedDeleteAfter)) + 50;
      expect(await deletes.undo([file])).toEqual({
        restored: [],
        gone: [file],
      });
      expect(await deletes.finalizeMarked([file])).toEqual([file]);
    });

    it("still undoes inside the window", async () => {
      // POSITIVE CONTROL for the deadline above: a mark written just now.
      const file = await unusedFile();
      await api(editor, "POST", ["deletions"], { body: { ids: [file] } });
      const undone = await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: [file] },
      });
      expect(undone.json).toMatchObject({ restored: [file], gone: [] });
    });

    it("marks none of a batch when marking any one of them fails", async () => {
      const files = [
        await unusedFile(),
        await unusedFile(),
        await unusedFile(),
      ];
      const failOn = pendingDeleteKey(files[2]!);
      const refuse = (data: Record<string, unknown>) =>
        data.key === failOn ? new Error("the third mark is refused") : null;
      // The adapter, failing the third item's mark whether it is written on
      // the pool or inside a transaction.
      const failing = {
        select: t.adapter.select.bind(t.adapter),
        delete: t.adapter.delete.bind(t.adapter),
        insert: (table: string, data: Record<string, unknown>) =>
          refuse(data)
            ? Promise.reject(refuse(data))
            : t.adapter.insert(table, data),
        transaction: (work: (tx: object) => Promise<unknown>) =>
          t.adapter.transaction(tx =>
            work(
              new Proxy(tx, {
                get(target, property, receiver) {
                  if (property === "insert") {
                    return (table: string, data: Record<string, unknown>) =>
                      refuse(data)
                        ? Promise.reject(refuse(data))
                        : target.insert(table, data);
                  }
                  const value: unknown = Reflect.get(
                    target,
                    property,
                    receiver
                  );
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
              })
            )
          ),
      } as unknown as PendingDeleteDb;
      const pending = new PendingMediaDeletes({
        db: failing,
        deleteItem: async () => undefined,
      });

      await expect(pending.mark(files)).rejects.toThrow();

      const marks = await t.adapter.select<Doc>("nextly_meta", {
        where: {
          and: [
            { column: "key", op: "IN", value: files.map(pendingDeleteKey) },
          ],
        },
      });
      expect(marks).toEqual([]);
      const listed = (
        (await api(editor, "GET", [], { query: "?limit=100" })).json
          .items as Doc[]
      ).map(item => item.id);
      expect(listed).toEqual(expect.arrayContaining(files));
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

    // Last, so its many items crowd no other test's first page of the list.
    it("marks a hundred and fifty items in one request, or none when one is missing", async () => {
      const files: string[] = [];
      for (let made = 0; made < 150; made += 1) files.push(await unusedFile());
      const marks = async () =>
        (
          await t.adapter.select<Doc>("nextly_meta", {
            columns: ["key"],
            where: {
              and: [
                {
                  column: "key",
                  op: "IN",
                  value: files.map(pendingDeleteKey),
                },
              ],
            },
          })
        ).length;

      const refused = await api(editor, "POST", ["deletions"], {
        body: { ids: [...files, randomUUID()] },
      });
      expect(refused.status).toBe(404);
      expect(await marks()).toBe(0);

      const deleted = await api(editor, "POST", ["deletions"], {
        body: { ids: files },
      });
      expect(deleted.status).toBe(200);
      expect((deleted.json.marked as string[]).length).toBe(150);
      expect(await marks()).toBe(150);
      const undone = await api(editor, "POST", ["deletions", "undo"], {
        body: { ids: files },
      });
      expect((undone.json.restored as string[]).length).toBe(150);
    }, 90_000);
  }
);
