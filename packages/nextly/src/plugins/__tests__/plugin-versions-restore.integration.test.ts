/**
 * A plugin restores a version through `ctx.services.versions.restore`, as REST
 * restores one: the chosen fields (all of them by default) go into the
 * document's working draft, and nothing published changes. A collection kept
 * without drafts has no working draft, so its restore is refused before any
 * write.
 *
 * Made as a person, the restore is judged as REST's restore route judges
 * them: `update-<collection>` to restore at all, then the document must be one
 * they can read, refused as not found when it is not. Made as the plugin
 * itself, with no options, it stays trusted. Every refusal leaves the draft as
 * it was.
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
import { registerHook, unregisterHook } from "../../hooks";
import type { AuthUserId } from "../../types/auth";
import { definePlugin } from "../index";
import type { ServiceOpts } from "../service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

/** A collection kept with drafts. */
const POSTS = "plugin_restore_posts";
/** A collection kept with versions as history only. */
const NOTES = "plugin_restore_notes";

/**
 * Restored over whatever is stored now, as these tests' saves are made: a
 * restore names the version it read, or says to overwrite, as a save does.
 */
const OVERWRITE = { version: { _overwrite: true } };

/** The plugin restore, with the trailing `ServiceOpts` it takes. */
interface PluginRestore {
  restore(
    ref: VersionRef,
    versionNo: number,
    options?: {
      fields?: string[];
      version?: Readonly<Record<string, unknown>>;
    },
    opts?: ServiceOpts
  ): Promise<{ restoredFrom: number }>;
}

interface Handler {
  createEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ data: { id: string } | null }>;
  updateEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ success: boolean }>;
  getEntry(
    params: Record<string, unknown>
  ): Promise<{ data: Record<string, unknown> | null }>;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's restore (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let versions: PluginRestore;
    let editorId: string;
    let readerId: string;
    let blindId: string;

    const probe = definePlugin({
      name: "@acme/restore-probe",
      version: "1.0.0",
      nextly: ">=0.0.1",
      init: ctx => {
        versions = ctx.services.versions as unknown as PluginRestore;
      },
    });

    const asUser = (id: string): ServiceOpts => ({
      user: { id: id as AuthUserId, email: `${id}@example.com` },
    });

    const handler = () =>
      t.getService("collectionsHandler") as unknown as Handler;

    /** A document published as "one", then as "two": versions 1 and 2. */
    async function publishedTwice(slug: string): Promise<VersionRef> {
      const created = await handler().createEntry(
        { collectionName: slug, overrideAccess: true },
        { title: "one", body: "body one", status: "published" }
      );
      const id = created.data!.id;
      const saved = await handler().updateEntry(
        { collectionName: slug, entryId: id, overrideAccess: true },
        {
          title: "two",
          body: "body two",
          status: "published",
          _overwrite: true,
        }
      );
      expect(saved.success).toBe(true);
      return { scopeKind: "collection", scopeSlug: slug, entryId: id };
    }

    /** The document's working draft as stored, or undefined for none. */
    async function draftOf(
      ref: VersionRef
    ): Promise<Record<string, unknown> | undefined> {
      const rows = await t.adapter.select<{ snapshot: unknown }>(
        "nextly_versions",
        {
          where: {
            and: [
              { column: "entryId", op: "=", value: ref.entryId },
              { column: "isAutosave", op: "=", value: false },
              { column: "versionNo", op: "IS NULL" },
              { column: "status", op: "=", value: "draft" },
            ],
          },
        }
      );
      const stored = rows[0]?.snapshot;
      return typeof stored === "string"
        ? (JSON.parse(stored) as Record<string, unknown>)
        : (stored as Record<string, unknown> | undefined);
    }

    /** What a read of the live document serves. */
    async function live(ref: VersionRef): Promise<Record<string, unknown>> {
      const read = await handler().getEntry({
        collectionName: ref.scopeSlug,
        entryId: ref.entryId,
        overrideAccess: true,
      });
      return read.data ?? {};
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [probe],
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" }), text({ name: "body" })],
          }),
          defineCollection({
            slug: NOTES,
            status: true,
            // Drafts are on by default with versions; turned off, versions
            // are history only.
            versions: { drafts: false },
            fields: [text({ name: "title" }), text({ name: "body" })],
          }),
        ],
      });
      await seedPermissions(t);
      editorId = await account(t, "restore-editor@example.com", [
        await role(t, "restore-editors", [`read-${POSTS}`, `update-${POSTS}`]),
      ]);
      readerId = await account(t, "restore-reader@example.com", [
        await role(t, "restore-readers", [`read-${POSTS}`]),
      ]);
      blindId = await account(t, "restore-blind@example.com", [
        await role(t, "restore-blind-updaters", [`update-${POSTS}`]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("hands the plugin's request and context to the restore's update, and names the person a trusted one is made for", async () => {
      const ref = await publishedTwice(POSTS);
      const seen: { request: boolean; tag: unknown } = {
        request: false,
        tag: undefined,
      };
      const watch = (ctx: {
        req?: { http?: unknown };
        context?: Record<string, unknown>;
        data?: unknown;
      }) => {
        seen.request = seen.request || ctx.req?.http !== undefined;
        seen.tag = seen.tag ?? ctx.context?.tag;
        return ctx.data;
      };
      registerHook("beforeUpdate", POSTS, watch as never);
      try {
        await versions.restore(ref, 1, OVERWRITE, {
          as: "system",
          user: {
            id: editorId as AuthUserId,
            email: "restore-editor@example.com",
          },
          request: new Request("http://localhost/api/restore", {
            method: "POST",
          }),
          context: { tag: "from-the-plugin" },
        } as ServiceOpts);
      } finally {
        unregisterHook("beforeUpdate", POSTS, watch as never);
      }

      expect(seen).toEqual({ request: true, tag: "from-the-plugin" });
      const events = await t.nextly.contentEvents.list({
        subject: { kind: "collection", slug: POSTS, id: ref.entryId },
      });
      expect(
        events.items.filter(e => e.kind === "restored").map(e => e.actorId)
      ).toContain(editorId);
    });

    it("is refused at once inside an open transaction, and the draft stays as it was", async () => {
      const ref = await publishedTwice(POSTS);
      const before = await draftOf(ref);

      // The restore's update takes the document's row lock in a transaction
      // of its own; inside one the plugin holds, it would wait on that lock.
      const adapter = t.adapter as unknown as {
        transaction<T>(work: () => Promise<T>): Promise<T>;
      };
      const refusal = await adapter
        .transaction(() => versions.restore(ref, 1, OVERWRITE))
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(await draftOf(ref)).toEqual(before);
    });

    it("restores into the working draft as the plugin itself, leaving what is published", async () => {
      const ref = await publishedTwice(POSTS);

      const result = await versions.restore(ref, 1, OVERWRITE);

      expect(result.restoredFrom).toBe(1);
      expect(await draftOf(ref)).toMatchObject({
        title: "one",
        body: "body one",
      });
      expect(await live(ref)).toMatchObject({ title: "two" });
    }, 120_000);

    it("restores only the fields it is asked for", async () => {
      const ref = await publishedTwice(POSTS);

      await versions.restore(ref, 1, { ...OVERWRITE, fields: ["title"] });

      const draft = await draftOf(ref);
      expect(draft?.title).toBe("one");
      expect(draft?.body ?? "body two").toBe("body two");
    }, 120_000);

    it("restores as a person who may read and update the document", async () => {
      const ref = await publishedTwice(POSTS);

      await versions.restore(ref, 1, OVERWRITE, asUser(editorId));

      expect(await draftOf(ref)).toMatchObject({ title: "one" });
      expect(await live(ref)).toMatchObject({ title: "two" });
    }, 120_000);

    it("is refused to a person who may not update, and nothing is written", async () => {
      const ref = await publishedTwice(POSTS);

      await expect(
        versions.restore(ref, 1, OVERWRITE, asUser(readerId))
      ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      expect(await draftOf(ref)).toBeUndefined();
    }, 120_000);

    it("is refused as not found to a person who may not read the document", async () => {
      const ref = await publishedTwice(POSTS);

      await expect(
        versions.restore(ref, 1, OVERWRITE, asUser(blindId))
      ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
      expect(await draftOf(ref)).toBeUndefined();
    }, 120_000);

    it("is refused where the collection keeps no drafts, and the document stays", async () => {
      const ref = await publishedTwice(NOTES);

      await expect(versions.restore(ref, 1, OVERWRITE)).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
        statusCode: 422,
      });
      expect(await live(ref)).toMatchObject({ title: "two" });
    }, 120_000);
  }
);
