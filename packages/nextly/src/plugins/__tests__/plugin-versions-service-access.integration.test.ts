/**
 * A plugin's history writes are checked when it says who it acts for.
 *
 * `ctx.services.versions` takes a trailing `ServiceOpts` on its three writes:
 * naming a version, discarding a working draft and recording an autosave. A
 * write made as a signed-in person is judged as the REST history routes judge
 * that person: `update-<collection>` to write at all, then the document must
 * be one they can read (refused as not found when it is not) and one they may
 * update, and an autosave needs the collection's autosave to be on. A write as
 * `{ as: "public" }` is refused as REST refuses an anonymous caller. A write as
 * the plugin itself, `{ as: "system" }` or no options, stays trusted. Every
 * refusal leaves the history as it was.
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
import type { VersionRef } from "../../domains/versions/versions-repository";
import type { AuthUserId } from "../../types/auth";
import { definePlugin } from "../index";
import type { ServiceOpts } from "../service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

/** A collection whose drafts autosave. */
const NOTES = "plugin_history_notes";
/** A collection with drafts but no autosave. */
const PLAIN = "plugin_history_plain";

/** The plugin history writes, with the trailing `ServiceOpts` each takes. */
interface PluginVersions {
  setLabel(
    ref: VersionRef,
    versionNo: number,
    label: string | null,
    by?: unknown,
    opts?: ServiceOpts
  ): Promise<unknown>;
  deleteWorkingDraft(
    ref: VersionRef,
    locale: string | null,
    opts?: ServiceOpts
  ): Promise<number>;
  autosave(
    input: {
      ref: VersionRef;
      status: "draft";
      snapshot: unknown;
      createdBy?: string | null;
    },
    opts?: ServiceOpts
  ): Promise<unknown>;
  get(ref: VersionRef, versionNo: number): Promise<{ label?: string | null }>;
  listWorkingDraftParts(ref: VersionRef): Promise<(string | null)[]>;
  getAutosave(ref: VersionRef, createdBy: string | null): Promise<unknown>;
}

interface Handler {
  createEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ data: { id: string } | null }>;
  updateEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's history writes under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let versions: PluginVersions;
    let ownerId: string;
    let editorId: string;
    let readerId: string;
    let blindId: string;

    const probe = definePlugin({
      name: "@acme/history-probe",
      version: "1.0.0",
      nextly: ">=0.0.1",
      init: ctx => {
        versions = ctx.services.versions as unknown as PluginVersions;
      },
    });

    const asUser = (id: string): ServiceOpts => ({
      user: { id: id as AuthUserId, email: `${id}@example.com` },
    });

    const refOf = (slug: string, entryId: string): VersionRef => ({
      scopeKind: "collection",
      scopeSlug: slug,
      entryId,
    });

    function handler(): Handler {
      return t.getService("collectionsHandler") as unknown as Handler;
    }

    /** A published document, made by trusted server code, with version 1. */
    async function published(slug: string, title: string): Promise<string> {
      const created = await handler().createEntry(
        {
          collectionName: slug,
          overrideAccess: true,
          user: { id: ownerId },
        },
        { title, status: "published" }
      );
      return created.data!.id;
    }

    /** A published document with an unpublished edit on top: a working draft. */
    async function withWorkingDraft(slug: string): Promise<VersionRef> {
      const id = await published(slug, "live");
      await handler().updateEntry(
        {
          collectionName: slug,
          entryId: id,
          overrideAccess: true,
          user: { id: ownerId },
        },
        { title: "edited", status: "draft" }
      );
      const ref = refOf(slug, id);
      expect(
        (await versions.listWorkingDraftParts(ref)).length,
        "the edit must leave a working draft"
      ).toBeGreaterThan(0);
      return ref;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [probe],
        collections: [
          defineCollection({
            slug: NOTES,
            status: true,
            versions: { drafts: { autosave: true } },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: PLAIN,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      await seedPermissions(t);
      ownerId = await account(t, "owner@example.com");
      editorId = await account(t, "editor@example.com", [
        await role(t, "history-editors", [
          `read-${NOTES}`,
          `update-${NOTES}`,
          `read-${PLAIN}`,
          `update-${PLAIN}`,
        ]),
      ]);
      readerId = await account(t, "reader@example.com", [
        await role(t, "history-readers", [`read-${NOTES}`]),
      ]);
      blindId = await account(t, "blind@example.com", [
        await role(t, "history-blind-updaters", [`update-${NOTES}`]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("naming a version", () => {
      it("is refused to a person who may not update, and the name stays", async () => {
        const ref = refOf(NOTES, await published(NOTES, "a"));
        await expect(
          versions.setLabel(ref, 1, "refused", undefined, asUser(readerId))
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await versions.get(ref, 1)).label ?? null).toBeNull();
      });

      it("is refused as not found to a person who may not read the document", async () => {
        const ref = refOf(NOTES, await published(NOTES, "b"));
        await expect(
          versions.setLabel(ref, 1, "hidden", undefined, asUser(blindId))
        ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
        expect((await versions.get(ref, 1)).label ?? null).toBeNull();
      });

      it("is refused to a public caller as an anonymous one", async () => {
        const ref = refOf(NOTES, await published(NOTES, "c"));
        await expect(
          versions.setLabel(ref, 1, "public", undefined, { as: "public" })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        expect((await versions.get(ref, 1)).label ?? null).toBeNull();
      });

      it("is made for a person who may read and update", async () => {
        const ref = refOf(NOTES, await published(NOTES, "d"));
        await versions.setLabel(ref, 1, "named", undefined, asUser(editorId));
        expect((await versions.get(ref, 1)).label).toBe("named");
      });

      it("stays trusted for the plugin acting as itself", async () => {
        const ref = refOf(NOTES, await published(NOTES, "e"));
        await versions.setLabel(ref, 1, "by the plugin");
        expect((await versions.get(ref, 1)).label).toBe("by the plugin");
      });
    });

    describe("discarding a working draft", () => {
      it("is refused to a person who may not update, and the draft stays", async () => {
        const ref = await withWorkingDraft(NOTES);
        await expect(
          versions.deleteWorkingDraft(ref, null, asUser(readerId))
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(
          (await versions.listWorkingDraftParts(ref)).length
        ).toBeGreaterThan(0);
      });

      it("is refused to a public caller as an anonymous one", async () => {
        const ref = await withWorkingDraft(NOTES);
        await expect(
          versions.deleteWorkingDraft(ref, null, { as: "public" })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(
          (await versions.listWorkingDraftParts(ref)).length
        ).toBeGreaterThan(0);
      });

      it("is done for a person who may read and update", async () => {
        const ref = await withWorkingDraft(NOTES);
        await versions.deleteWorkingDraft(ref, null, asUser(editorId));
        expect(await versions.listWorkingDraftParts(ref)).toEqual([]);
      });
    });

    describe("recording an autosave", () => {
      const snapshot = { title: "typing" };

      it("is refused to a person who may not update, and nothing is kept", async () => {
        const ref = refOf(NOTES, await published(NOTES, "f"));
        await expect(
          versions.autosave(
            { ref, status: "draft", snapshot, createdBy: readerId },
            asUser(readerId)
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await versions.getAutosave(ref, readerId)).toBeUndefined();
      });

      it("is refused where the collection's autosave is off, even to an editor", async () => {
        const ref = refOf(PLAIN, await published(PLAIN, "g"));
        await expect(
          versions.autosave(
            { ref, status: "draft", snapshot, createdBy: editorId },
            asUser(editorId)
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await versions.getAutosave(ref, editorId)).toBeUndefined();
      });

      it("is kept for a person who may read and update, where autosave is on", async () => {
        const ref = refOf(NOTES, await published(NOTES, "h"));
        await versions.autosave(
          { ref, status: "draft", snapshot, createdBy: editorId },
          asUser(editorId)
        );
        expect(await versions.getAutosave(ref, editorId)).toBeDefined();
      });

      it("stays trusted for the plugin acting as itself", async () => {
        const ref = refOf(NOTES, await published(NOTES, "i"));
        await versions.autosave({
          ref,
          status: "draft",
          snapshot,
          createdBy: ownerId,
        });
        expect(await versions.getAutosave(ref, ownerId)).toBeDefined();
      });
    });
  }
);
