/**
 * A plugin's media writes are checked when it says who it acts for.
 *
 * `ctx.services.media` takes `ServiceOpts` where its writes take a caller, as
 * `ctx.services.collections` does. A write made as a signed-in person
 * (`{ user }` or `{ as: "user", user }`) is judged as the REST media routes
 * judge that person: `create-media`, `update-media`, `delete-media`. A write
 * as `{ as: "public" }` is refused as REST refuses an anonymous caller. A
 * write as the plugin itself, `{ as: "system" }` or no options, stays trusted,
 * and a `user` named beside `system` is recorded as the one who made it. Every
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
import { registerHook } from "../../hooks";
import { definePlugin } from "../../plugins";
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

/**
 * The plugin media writes, called with `ServiceOpts` where each takes its
 * caller. Typed here so the test states the surface it relies on.
 */
interface PluginMedia {
  upload(input: unknown, opts?: ServiceOpts): Promise<{ id: string }>;
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

    describe("the plugin acting as itself", () => {
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
