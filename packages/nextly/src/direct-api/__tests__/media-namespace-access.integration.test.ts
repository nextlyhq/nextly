/**
 * The Direct API's `media` namespace is checked when its caller asks to be.
 *
 * A Nextly instance (or a single call) with `overrideAccess: false` and a
 * `user` is judged as the REST media routes judge that user: `create-media` to
 * upload or make a folder, `update-media` to change a file, `delete-media` to
 * delete one or many. An API key is judged by its own grants. A checked call
 * that names nobody is refused as REST refuses an anonymous caller. Every
 * refusal leaves the library as it was, and a trusted instance, the default,
 * keeps doing what server code asks of it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";
import { Nextly } from "../nextly";

import { account, role, seedPermissions } from "./checked-access-fixtures";

/** Every permission the media write routes name. */
const MEDIA_WRITES = ["create-media", "update-media", "delete-media"];

/** One buffer, reused for the bytes and the size that describes them. */
const PDF = pdfDocument("checked");

function file(name: string) {
  return {
    data: PDF,
    name,
    mimetype: "application/pdf",
    size: PDF.length,
  };
}

describe.each(getConfiguredTestDialects())(
  "the Direct API's media namespace under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let holderId: string;
    let lackerId: string;
    let ownerId: string;

    /** An instance that asks to be checked, as this person. */
    function checkedAs(userId: string): Nextly {
      return new Nextly({ overrideAccess: false, user: { id: userId } });
    }

    /** A file uploaded by trusted server code, for the writes below to act on. */
    async function stored(name = "subject.pdf"): Promise<string> {
      const uploaded = await trusted.media.upload({ file: file(name) });
      return uploaded.id;
    }

    async function exists(id: string): Promise<boolean> {
      // A missing file answers null rather than throwing only when asked to.
      return (
        (await trusted.media.findByID({ id, disableErrors: true })) !== null
      );
    }

    async function fileCount(): Promise<number> {
      return (await trusted.media.find({ limit: 1000 })).items.length;
    }

    async function folderCount(): Promise<number> {
      return (await trusted.media.folders.list()).length;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      trusted = new Nextly();
      await seedPermissions(t);

      // The install's first account holds super-admin, which answers every
      // check; the accounts under test come after it.
      ownerId = await account(t, "owner@example.com");
      holderId = await account(t, "holder@example.com", [
        await role(t, "media-writers", ["read-media", ...MEDIA_WRITES]),
      ]);
      lackerId = await account(t, "lacker@example.com", [
        await role(t, "media-readers", ["read-media"]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("a person without the permission", () => {
      it("is refused uploading, and no file is added", async () => {
        const before = await fileCount();
        await expect(
          checkedAs(lackerId).media.upload({ file: file("refused.pdf") })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await fileCount()).toBe(before);
      });

      it("is refused making a folder, and none is made", async () => {
        const before = await folderCount();
        await expect(
          checkedAs(lackerId).media.folders.create({ name: "refused" })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await folderCount()).toBe(before);
      });

      it("is refused changing a file, and it keeps its alt text", async () => {
        const id = await stored();
        await trusted.media.update({ id, data: { altText: "kept" } });
        await expect(
          checkedAs(lackerId).media.update({
            id,
            data: { altText: "changed" },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await trusted.media.findByID({ id }))?.altText).toBe("kept");
      });

      it("is refused deleting a file, and it stays", async () => {
        const id = await stored();
        await expect(
          checkedAs(lackerId).media.delete({ id })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await exists(id)).toBe(true);
      });

      it("is refused deleting files in bulk, and every one stays", async () => {
        const ids = [await stored("one.pdf"), await stored("two.pdf")];
        await expect(
          checkedAs(lackerId).media.bulkDelete({ ids })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        for (const id of ids) expect(await exists(id)).toBe(true);
      });
    });

    describe("who is asking", () => {
      it("refuses a checked call that names nobody, and changes nothing", async () => {
        const anonymous = new Nextly({ overrideAccess: false });
        const id = await stored();
        const before = await fileCount();

        await expect(
          anonymous.media.upload({ file: file("nobody.pdf") })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        await expect(
          anonymous.media.folders.create({ name: "nobody" })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
        await expect(
          anonymous.media.update({ id, data: { altText: "nobody" } })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
        await expect(anonymous.media.delete({ id })).rejects.toMatchObject({
          code: "AUTH_REQUIRED",
        });
        await expect(
          anonymous.media.bulkDelete({ ids: [id] })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

        expect(await fileCount()).toBe(before);
        expect(await exists(id)).toBe(true);
      });

      it("judges an API key by its own grants, not its owner's", async () => {
        // The owner may write media; the key was given only read.
        const readOnly: AuthenticatedScope = {
          actorType: "apiKey",
          permissions: ["read-media"],
        };
        const asKey = new Nextly({
          overrideAccess: false,
          user: { id: holderId },
          actor: readOnly,
        });
        const before = await fileCount();
        await expect(
          asKey.media.upload({ file: file("by-a-key.pdf") })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await fileCount()).toBe(before);

        // The control: a key granted the write may make it.
        const writer: AuthenticatedScope = {
          actorType: "apiKey",
          permissions: ["read-media", "create-media"],
        };
        const uploaded = await new Nextly({
          overrideAccess: false,
          user: { id: holderId },
          actor: writer,
        }).media.upload({ file: file("by-a-writing-key.pdf") });
        expect(await exists(uploaded.id)).toBe(true);
      });

      it("keeps the instance's check when a call leaves overrideAccess undefined", async () => {
        const before = await fileCount();
        await expect(
          checkedAs(lackerId).media.upload({
            file: file("undefined.pdf"),
            overrideAccess: undefined,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await fileCount()).toBe(before);
      });

      it("checks a single call that asks to be checked on a trusted instance", async () => {
        const before = await fileCount();
        await expect(
          trusted.media.upload({
            file: file("one-call.pdf"),
            overrideAccess: false,
            user: { id: lackerId },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await fileCount()).toBe(before);
      });
    });

    describe("who a checked write is recorded as", () => {
      /** The actor the outbox recorded for a media write to this file. */
      async function recordedActor(
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

      it("records a write made with an API key as the key, not its owner", async () => {
        const key = new Nextly({
          overrideAccess: false,
          user: { id: holderId },
          actor: {
            actorType: "apiKey",
            permissions: ["read-media", "create-media", "update-media"],
          },
        });
        const uploaded = await key.media.upload({ file: file("keyed.pdf") });
        expect((await recordedActor("media.uploaded", uploaded.id))?.[0]).toBe(
          "apiKey"
        );
        await key.media.update({ id: uploaded.id, data: { altText: "keyed" } });
        expect((await recordedActor("media.updated", uploaded.id))?.[0]).toBe(
          "apiKey"
        );
      });

      it("records a call that names its own user, on a keyed instance, as that user", async () => {
        // The check judges such a call as the person it names, so the record
        // names that person too, not the instance's key.
        const keyed = new Nextly({
          overrideAccess: false,
          user: { id: lackerId },
          actor: { actorType: "apiKey", permissions: ["read-media"] },
        });
        const uploaded = await keyed.media.upload({
          file: file("named-person.pdf"),
          user: { id: holderId },
        });
        expect(await recordedActor("media.uploaded", uploaded.id)).toEqual([
          "user",
          holderId,
        ]);
      });

      it("records a write made as a person as that person", async () => {
        const uploaded = await checkedAs(holderId).media.upload({
          file: file("personal.pdf"),
        });
        expect(await recordedActor("media.uploaded", uploaded.id)).toEqual([
          "user",
          holderId,
        ]);
      });
    });

    describe("a person with the permission", () => {
      it("uploads, changes, makes a folder and deletes, as REST would let them", async () => {
        const writer = checkedAs(holderId);

        const uploaded = await writer.media.upload({
          file: file("permitted.pdf"),
        });
        expect(await exists(uploaded.id)).toBe(true);

        await writer.media.update({
          id: uploaded.id,
          data: { altText: "by the holder" },
        });
        expect(
          (await trusted.media.findByID({ id: uploaded.id }))?.altText
        ).toBe("by the holder");

        const folder = await writer.media.folders.create({ name: "permitted" });
        expect(folder.id).toBeTruthy();

        await writer.media.delete({ id: uploaded.id });
        expect(await exists(uploaded.id)).toBe(false);

        const ids = [await stored("bulk-a.pdf"), await stored("bulk-b.pdf")];
        await writer.media.bulkDelete({ ids });
        for (const id of ids) expect(await exists(id)).toBe(false);
      });
    });

    describe("trusted server code", () => {
      it("keeps writing media without a caller, as it always has", async () => {
        const id = await stored("trusted.pdf");
        await trusted.media.update({ id, data: { altText: "trusted" } });
        expect((await trusted.media.findByID({ id }))?.altText).toBe("trusted");
        // A folder records who made it, and the column refers to a user, so
        // server code names one; the call stays trusted.
        const folder = await trusted.media.folders.create({
          name: "trusted",
          user: { id: ownerId },
        });
        expect(folder.id).toBeTruthy();
        await trusted.media.delete({ id });
        expect(await exists(id)).toBe(false);
      });
    });
  }
);
