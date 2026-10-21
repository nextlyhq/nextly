/**
 * A plugin's media writes are checked when it says who it acts for.
 *
 * `ctx.services.media` takes `ServiceOpts` where its writes take a caller, as
 * `ctx.services.collections` does. A write made as a signed-in person
 * (`{ user }` or `{ as: "user", user }`) is judged as the REST media routes
 * judge that person: `create-media`, `update-media`, `delete-media`. A write
 * as `{ as: "public" }` is refused as REST refuses an anonymous caller. A
 * write as the plugin itself, `{ as: "system" }` or no options, stays trusted,
 * and a `user` named beside `system` is recorded as the one who made it. A
 * request context, the shape these writes took before, is read as the options
 * it stands for, and a checked write records its caller as the actor. Every
 * refusal leaves the library as it was.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, text } from "../../config";
import {
  account,
  role,
  seedPermissions,
} from "../../direct-api/__tests__/checked-access-fixtures";
import { Nextly } from "../../direct-api/nextly";
import {
  currentCallerScope,
  runWithCallerScope,
} from "../../auth/caller-scope";
import { currentPrincipal, runAsPrincipal } from "../../auth/principal-scope";
import { getEventBus } from "../../events/event-bus";
import { registerHook } from "../../hooks";
import { definePlugin } from "../../plugins";
import { makePrincipal } from "../principals/principal";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";
import type { AuthUserId } from "../../types/auth";
import type { ServiceOpts } from "../service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const PDF = pdfDocument("plugin");

/** A collection the plugin writes to as itself, on someone's behalf. */
const NOTES = "plugin_access_notes";

function input(name: string) {
  return {
    buffer: PDF,
    filename: name,
    mimeType: "application/pdf",
    size: PDF.length,
  };
}

/** The request context the media writes were typed with before `ServiceOpts`. */
interface LegacyContext {
  user: { id: string; email: string; role: string; permissions: string[] };
}

/**
 * The plugin media writes, called with `ServiceOpts` where each takes its
 * caller. Typed here so the test states the surface it relies on.
 */
interface PluginMedia {
  upload(
    input: unknown,
    opts?: ServiceOpts | LegacyContext,
    actor?: { type: "user" | "apiKey"; id?: string }
  ): Promise<{ id: string }>;
  bulkUpload(inputs: unknown[], opts?: ServiceOpts): Promise<unknown>;
  update(id: string, input: unknown, opts?: ServiceOpts): Promise<unknown>;
  delete(id: string, opts?: ServiceOpts): Promise<void>;
  bulkDelete(ids: string[], opts?: ServiceOpts): Promise<unknown>;
  moveToFolder(
    id: string,
    folderId: string | null,
    opts?: ServiceOpts
  ): Promise<void>;
  createFolder(
    input: { name: string; parentId?: string | null },
    opts?: ServiceOpts
  ): Promise<{ id: string; createdBy?: string | null }>;
  updateFolder(
    id: string,
    input: { name?: string },
    opts?: ServiceOpts
  ): Promise<unknown>;
  deleteFolder(
    id: string,
    deleteContents?: boolean,
    opts?: ServiceOpts
  ): Promise<void>;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's media writes under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let media: PluginMedia;
    let collections: {
      createEntry(
        slug: string,
        data: Record<string, unknown>,
        opts?: ServiceOpts
      ): Promise<unknown>;
    };
    let ownerId: string;
    let holderId: string;
    let lackerId: string;
    /** People holding one media write each, so each mapping is told apart. */
    let creatorId: string;
    let updaterId: string;
    let deleterId: string;

    const probe = definePlugin({
      name: "@acme/media-probe",
      version: "1.0.0",
      nextly: ">=0.0.1",
      init: ctx => {
        media = ctx.services.media as unknown as PluginMedia;
        collections = ctx.services.collections as unknown as typeof collections;
      },
    });

    const asUser = (id: string): ServiceOpts => ({
      user: { id: id as AuthUserId, email: `${id}@example.com` },
    });

    async function storedFile(name = "subject.pdf"): Promise<string> {
      return (
        await trusted.media.upload({
          file: {
            data: PDF,
            name,
            mimetype: "application/pdf",
            size: PDF.length,
          },
        })
      ).id;
    }

    async function storedFolder(name: string): Promise<string> {
      return (
        await trusted.media.folders.create({
          name,
          user: { id: ownerId },
        })
      ).id;
    }

    async function exists(id: string): Promise<boolean> {
      return (
        (await trusted.media.findByID({ id, disableErrors: true })) !== null
      );
    }

    async function fileCount(): Promise<number> {
      return (await trusted.media.find({ limit: 1000 })).items.length;
    }

    async function folderNames(): Promise<string[]> {
      return (await trusted.media.folders.list()).map(f => f.name);
    }

    /** Who the outbox recorded as making this kind of write to this file. */
    async function recordedBy(
      type: string,
      mediaId: string
    ): Promise<[string | null, string | null] | undefined> {
      const rows = await t.adapter.select<{
        type: string;
        resourceId: string | null;
        actorType: string | null;
        actorId: string | null;
      }>("nextly_events");
      const row = rows.find(r => r.type === type && r.resourceId === mediaId);
      return row ? [row.actorType, row.actorId] : undefined;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [probe],
        collections: [
          defineCollection({
            slug: NOTES,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      trusted = new Nextly();
      await seedPermissions(t);
      ownerId = await account(t, "owner@example.com");
      holderId = await account(t, "holder@example.com", [
        await role(t, "plugin-media-writers", [
          "read-media",
          "create-media",
          "update-media",
          "delete-media",
        ]),
      ]);
      lackerId = await account(t, "lacker@example.com", [
        await role(t, "plugin-media-readers", ["read-media"]),
      ]);
      creatorId = await account(t, "creator@example.com", [
        await role(t, "plugin-media-creators", ["read-media", "create-media"]),
      ]);
      updaterId = await account(t, "updater@example.com", [
        await role(t, "plugin-media-updaters", ["read-media", "update-media"]),
      ]);
      deleterId = await account(t, "deleter@example.com", [
        await role(t, "plugin-media-deleters", ["read-media", "delete-media"]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("a person without the permission", () => {
      const refused = { code: "FORBIDDEN", statusCode: 403 };

      it("is refused uploading, one or many, and no file is added", async () => {
        const before = await fileCount();
        await expect(
          media.upload(input("refused.pdf"), asUser(lackerId))
        ).rejects.toMatchObject(refused);
        await expect(
          media.bulkUpload([input("refused-bulk.pdf")], asUser(lackerId))
        ).rejects.toMatchObject(refused);
        expect(await fileCount()).toBe(before);
      });

      it("is refused changing, moving or deleting a file, and it stays as it was", async () => {
        const id = await storedFile();
        const folderId = await storedFolder("move-target");
        await expect(
          media.update(id, { altText: "changed" }, asUser(lackerId))
        ).rejects.toMatchObject(refused);
        await expect(
          media.moveToFolder(id, folderId, asUser(lackerId))
        ).rejects.toMatchObject(refused);
        await expect(media.delete(id, asUser(lackerId))).rejects.toMatchObject(
          refused
        );
        await expect(
          media.bulkDelete([id], asUser(lackerId))
        ).rejects.toMatchObject(refused);
        const kept = await trusted.media.findByID({ id });
        expect(kept?.altText ?? null).toBeNull();
        expect(kept?.folderId ?? null).toBeNull();
      });

      it("is refused making, renaming or deleting a folder, and the folders stay", async () => {
        const id = await storedFolder("kept-folder");
        await expect(
          media.createFolder({ name: "refused-folder" }, asUser(lackerId))
        ).rejects.toMatchObject(refused);
        await expect(
          media.updateFolder(id, { name: "renamed" }, asUser(lackerId))
        ).rejects.toMatchObject(refused);
        await expect(
          media.deleteFolder(id, false, asUser(lackerId))
        ).rejects.toMatchObject(refused);
        const names = await folderNames();
        expect(names).toContain("kept-folder");
        expect(names).not.toContain("refused-folder");
        expect(names).not.toContain("renamed");
      });
    });

    describe("who is asking", () => {
      it("refuses a public write as REST refuses an anonymous caller", async () => {
        const before = await fileCount();
        await expect(
          media.upload(input("public.pdf"), { as: "public" })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        expect(await fileCount()).toBe(before);
      });

      it("reads a request context as the options it stands for, believing none of its grants", async () => {
        // The shape these writes were typed with before. Its user is checked
        // as that user; the role and permissions it claims are not believed,
        // since a person's roles are read from their account.
        const before = await fileCount();
        await expect(
          media.upload(input("legacy.pdf"), {
            user: {
              id: lackerId,
              email: "lacker@example.com",
              role: "super-admin",
              permissions: ["create-media"],
            },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await fileCount()).toBe(before);
      });

      it("refuses a checked write that names someone else as the actor", async () => {
        const before = await fileCount();
        await expect(
          media.upload(input("spoofed.pdf"), asUser(holderId), {
            type: "user",
            id: ownerId,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await fileCount()).toBe(before);
      });

      it("takes a checked write that names its own caller as the actor", async () => {
        const uploaded = await media.upload(
          input("own-actor.pdf"),
          asUser(holderId),
          { type: "user", id: holderId }
        );
        expect(await recordedBy("media.uploaded", uploaded.id)).toEqual([
          "user",
          holderId,
        ]);
      });

      it("takes a checked write whose actor names only the caller's kind", async () => {
        // `{ type: "user" }` names no one else; it is recorded as the caller.
        const uploaded = await media.upload(
          input("kind-only-actor.pdf"),
          asUser(holderId),
          { type: "user" }
        );
        expect(await recordedBy("media.uploaded", uploaded.id)).toEqual([
          "user",
          holderId,
        ]);
      });

      it("lets a person with the permission write", async () => {
        const uploaded = await media.upload(
          input("permitted.pdf"),
          asUser(holderId)
        );
        expect(await exists(uploaded.id)).toBe(true);
        await media.delete(uploaded.id, { as: "user", ...asUser(holderId) });
        expect(await exists(uploaded.id)).toBe(false);
      });
    });

    describe("each write asks for its own permission", () => {
      const refused = { code: "FORBIDDEN", statusCode: 403 };

      it("lets only create-media upload or make a folder", async () => {
        const uploaded = await media.upload(
          input("by-creator.pdf"),
          asUser(creatorId)
        );
        expect(await exists(uploaded.id)).toBe(true);
        await media.createFolder({ name: "by-creator" }, asUser(creatorId));
        for (const other of [updaterId, deleterId]) {
          await expect(
            media.upload(input("not-yours.pdf"), asUser(other))
          ).rejects.toMatchObject(refused);
          await expect(
            media.createFolder({ name: "not-yours" }, asUser(other))
          ).rejects.toMatchObject(refused);
        }
      });

      it("lets only update-media change, move or rename", async () => {
        const id = await storedFile("to-change.pdf");
        const folderId = await storedFolder("to-rename");
        for (const other of [creatorId, deleterId]) {
          await expect(
            media.update(id, { altText: "no" }, asUser(other))
          ).rejects.toMatchObject(refused);
          await expect(
            media.moveToFolder(id, folderId, asUser(other))
          ).rejects.toMatchObject(refused);
          await expect(
            media.updateFolder(folderId, { name: "no" }, asUser(other))
          ).rejects.toMatchObject(refused);
        }
        await media.update(
          id,
          { altText: "by the updater" },
          asUser(updaterId)
        );
        await media.moveToFolder(id, folderId, asUser(updaterId));
        await media.updateFolder(
          folderId,
          { name: "renamed" },
          asUser(updaterId)
        );
        expect(await folderNames()).toContain("renamed");
      });

      it("lets only delete-media delete a file, many files or a folder", async () => {
        const one = await storedFile("to-delete.pdf");
        const many = await storedFile("to-delete-many.pdf");
        const folderId = await storedFolder("to-delete");
        for (const other of [creatorId, updaterId]) {
          await expect(media.delete(one, asUser(other))).rejects.toMatchObject(
            refused
          );
          await expect(
            media.bulkDelete([many], asUser(other))
          ).rejects.toMatchObject(refused);
          await expect(
            media.deleteFolder(folderId, false, asUser(other))
          ).rejects.toMatchObject(refused);
        }
        await media.delete(one, asUser(deleterId));
        await media.bulkDelete([many], asUser(deleterId));
        await media.deleteFolder(folderId, false, asUser(deleterId));
        expect(await exists(one)).toBe(false);
        expect(await exists(many)).toBe(false);
        expect(await folderNames()).not.toContain("to-delete");
      });
    });

    describe("the plugin acting as itself", () => {
      it("runs what it sets going as the plugin, not as a plugin person whose frame it is in", async () => {
        // A write is its own call: one the plugin makes from inside an
        // operation run as one of its people is still the plugin's, so an
        // event handler it starts runs with no person.
        let seen: unknown = "unset";
        const handler = () => {
          seen = currentPrincipal();
        };
        getEventBus().on("media.uploaded", handler);
        try {
          await runAsPrincipal(
            makePrincipal("accounts:account", "acc_frame", { verified: true }),
            () => media.upload(input("in-a-frame.pdf"))
          );
        } finally {
          getEventBus().off("media.uploaded", handler);
        }
        expect(seen).toBeNull();
      });

      it("runs what a keyed write sets going under the key it was checked as", async () => {
        // Inside a request made with a broad key, a write naming a narrower
        // one runs what it starts under the narrower key.
        const broad = {
          actorType: "apiKey" as const,
          permissions: ["read-media", "create-media", "delete-media"],
        };
        const narrow = {
          actorType: "apiKey" as const,
          permissions: ["read-media", "create-media"],
        };
        let seen: readonly string[] | undefined;
        const handler = () => {
          seen = currentCallerScope()?.permissions;
        };
        getEventBus().on("media.uploaded", handler);
        try {
          await runWithCallerScope(broad, () =>
            media.upload(input("narrowed.pdf"), {
              ...asUser(holderId),
              authenticatedScope: narrow,
            })
          );
        } finally {
          getEventBus().off("media.uploaded", handler);
        }
        expect(seen).toEqual(narrow.permissions);
      });

      it("stays trusted with no options at all", async () => {
        const uploaded = await media.upload(input("system.pdf"));
        expect(await exists(uploaded.id)).toBe(true);
      });

      it("makes a folder as system, recording the user named beside it", async () => {
        // The person lacks `create-media`: only a trusted call could make it.
        const folder = await media.createFolder(
          { name: "made-for-lacker" },
          { as: "system", ...asUser(lackerId) }
        );
        expect(folder.id).toBeTruthy();
        const stored = (await trusted.media.folders.list()).find(
          f => f.id === folder.id
        );
        expect(stored?.createdBy).toBe(lackerId);
      });

      it("writes to a collection as system, handing its hooks the user named beside it", async () => {
        // The person holds no permission on the collection: only a trusted
        // call could write it, and the hook shows whom it was made for.
        let seen: string | undefined;
        registerHook("beforeCreate", NOTES, context => {
          seen = context.user?.id;
          return context.data;
        });
        await collections.createEntry(
          NOTES,
          { title: "for the lacker" },
          { as: "system", ...asUser(lackerId) }
        );
        expect(seen).toBe(lackerId);
      });
    });
  }
);
