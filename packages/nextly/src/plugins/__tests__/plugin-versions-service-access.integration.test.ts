/**
 * A plugin's history writes are checked when it says who it acts for.
 *
 * `ctx.services.versions` takes a trailing `ServiceOpts` on its three writes:
 * naming a version, discarding a working draft and recording an autosave. A
 * write made as a signed-in person is judged as the REST history routes judge
 * that person: `update-<collection>` to write at all, then the document must
 * be one they can read (refused as not found when it is not) and one they may
 * update, and an autosave needs the collection's autosave to be on. The caller
 * is the author, as on REST: a write that names no namer or author is recorded
 * as the caller's, and one that names someone else is refused. A page's history
 * has no REST write to be judged as, so a checked write to it is refused. A
 * write as `{ as: "public" }` is refused as REST refuses an anonymous caller. A
 * write as the plugin itself, `{ as: "system" }` or no options, stays trusted.
 * Every refusal leaves the history as it was.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAsPrincipal } from "../../auth/principal-scope";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, password, text } from "../../config";
import {
  account,
  role,
  seedPermissions,
} from "../../direct-api/__tests__/checked-access-fixtures";
import type { VersionRef } from "../../domains/versions/versions-repository";
import { registerHook, unregisterHook } from "../../hooks";
import type { AuthUserId } from "../../types/auth";
import { definePlugin } from "../index";
import { makePrincipal } from "../principals/principal";
import type { ServiceOpts } from "../service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

/** A collection whose drafts autosave. */
const NOTES = "plugin_history_notes";
/** A collection with drafts but autosave turned off: drafts alone turn it on. */
const PLAIN = "plugin_history_plain";
/** A collection with a field its editors may not read. */
const GUARDED = "plugin_history_guarded";
/** An autosaving collection with a password field. */
const SECRETS = "plugin_history_secrets";

/** The plugin history writes, with the trailing `ServiceOpts` each takes. */
interface PluginVersions {
  setLabel(
    ref: VersionRef,
    versionNo: number,
    label: string | null,
    by?: unknown,
    opts?: ServiceOpts
  ): Promise<{ snapshot?: unknown }>;
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
  getAutosave(
    ref: VersionRef,
    createdBy: string | null
  ): Promise<{ snapshot: unknown } | undefined>;
  listEvents(
    subject: { kind: "collection"; slug: string; id: string },
    query?: { kinds?: string[] }
  ): Promise<{
    items: {
      actorKind: string;
      actorId: string | null;
      actorName: string | null;
    }[];
  }>;
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

    /** The working-draft parts, read from the service: the plugin view has no such read. */
    function draftParts(ref: VersionRef): Promise<(string | null)[]> {
      return t.getService("versionsService").listWorkingDraftParts(ref);
    }

    /** A page's history, which no REST route writes to. */
    const pageRef = (entryId: string): VersionRef => ({
      scopeKind: "page",
      scopeSlug: "plugin_history_page",
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

    /**
     * A published document with an unpublished edit on top: a working draft.
     * The edit names no status, which is what holds it rather than writing it
     * live.
     */
    async function withWorkingDraft(slug: string): Promise<VersionRef> {
      const id = await published(slug, "live");
      await handler().updateEntry(
        {
          collectionName: slug,
          entryId: id,
          overrideAccess: true,
          user: { id: ownerId },
        },
        { title: "edited" }
      );
      const ref = refOf(slug, id);
      expect(
        (await draftParts(ref)).length,
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
            slug: GUARDED,
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              text({ name: "internal", access: { read: () => false } }),
            ],
          }),
          defineCollection({
            slug: SECRETS,
            status: true,
            versions: { drafts: { autosave: true } },
            fields: [text({ name: "title" }), password({ name: "pin" })],
          }),
          defineCollection({
            slug: PLAIN,
            status: true,
            versions: { drafts: { autosave: false } },
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
          `read-${SECRETS}`,
          `update-${SECRETS}`,
          `read-${GUARDED}`,
          `update-${GUARDED}`,
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

      it("is recorded as the caller's when the call names no namer", async () => {
        const id = await published(NOTES, "j");
        await versions.setLabel(
          refOf(NOTES, id),
          1,
          "mine",
          undefined,
          asUser(editorId)
        );
        const { items } = await versions.listEvents(
          { kind: "collection", slug: NOTES, id },
          { kinds: ["named"] }
        );
        expect(items.map(e => [e.actorKind, e.actorId])).toEqual([
          ["person", editorId],
        ]);
      });

      it("is refused when it names someone else as the namer, and the name stays", async () => {
        const ref = refOf(NOTES, await published(NOTES, "k"));
        await expect(
          versions.setLabel(
            ref,
            1,
            "theirs",
            { actor: { type: "user", id: ownerId } },
            asUser(editorId)
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await versions.get(ref, 1)).label ?? null).toBeNull();
      });

      it("hands back no field the caller may not read", async () => {
        // The version is a copy of the document, so what the call returns is
        // what the caller may read of it, as on REST, which returns none of it.
        const created = await handler().createEntry(
          {
            collectionName: GUARDED,
            overrideAccess: true,
            user: { id: ownerId },
          },
          { title: "public", internal: "hidden-note", status: "published" }
        );
        const ref = refOf(GUARDED, created.data!.id);
        const named = await versions.setLabel(
          ref,
          1,
          "named",
          undefined,
          asUser(editorId)
        );
        expect(JSON.stringify(named)).not.toContain("hidden-note");
      });

      it("records the caller's own name, not the one the plugin passes", async () => {
        // The name shown beside the event is the authenticated caller's, as on
        // REST, however `by` describes the namer.
        const id = await published(NOTES, "p");
        await versions.setLabel(
          refOf(NOTES, id),
          1,
          "named by editor",
          { actor: { type: "user", id: editorId }, personName: "Someone Else" },
          {
            user: {
              id: editorId as AuthUserId,
              email: "editor@example.com",
              name: "Editor",
            },
          }
        );
        const { items } = await versions.listEvents(
          { kind: "collection", slug: NOTES, id },
          { kinds: ["named"] }
        );
        expect(items.map(e => e.actorName)).toEqual(["Editor"]);
      });

      it("is made for an API key holding the grants, recording no namer it cannot name", async () => {
        // A key's own id is not known to a plugin, and an event naming the
        // key's owner would put a person against a change they did not make,
        // so the name is set and no event names anyone.
        const id = await published(NOTES, "q");
        const ref = refOf(NOTES, id);
        await versions.setLabel(ref, 1, "by a key", undefined, {
          ...asUser(editorId),
          authenticatedScope: {
            actorType: "apiKey",
            permissions: [`read-${NOTES}`, `update-${NOTES}`],
          },
        });
        expect((await versions.get(ref, 1)).label).toBe("by a key");
        const { items } = await versions.listEvents(
          { kind: "collection", slug: NOTES, id },
          { kinds: ["named"] }
        );
        expect(items).toEqual([]);
      });

      it("is judged as the person it names, inside another person's frame", async () => {
        // A write the plugin makes from within an operation run as one of its
        // own people is a new call: it is judged as whom it names.
        const ref = refOf(NOTES, await published(NOTES, "r"));
        await runAsPrincipal(
          makePrincipal("accounts:account", "acc_frame", { verified: true }),
          () =>
            versions.setLabel(
              ref,
              1,
              "from a frame",
              undefined,
              asUser(editorId)
            )
        );
        expect((await versions.get(ref, 1)).label).toBe("from a frame");
      });

      it("hands the document's read hooks the context the plugin passes", async () => {
        const ref = refOf(NOTES, await published(NOTES, "s"));
        const refuseWhenAsked = (ctx: { context: Record<string, unknown> }) => {
          if (ctx.context.deny === true) throw new Error("refused by a hook");
          return (ctx as { data?: unknown }).data;
        };
        registerHook("beforeRead", NOTES, refuseWhenAsked as never);
        try {
          await expect(
            versions.setLabel(ref, 1, "hooked", undefined, {
              ...asUser(editorId),
              context: { deny: true },
            })
          ).rejects.toBeDefined();
        } finally {
          unregisterHook("beforeRead", NOTES, refuseWhenAsked as never);
        }
        expect((await versions.get(ref, 1)).label ?? null).toBeNull();
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
        expect((await draftParts(ref)).length).toBeGreaterThan(0);
      });

      it("is refused to a public caller as an anonymous one", async () => {
        const ref = await withWorkingDraft(NOTES);
        await expect(
          versions.deleteWorkingDraft(ref, null, { as: "public" })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
        expect((await draftParts(ref)).length).toBeGreaterThan(0);
      });

      it("is done for a person who may read and update", async () => {
        const ref = await withWorkingDraft(NOTES);
        await versions.deleteWorkingDraft(ref, null, asUser(editorId));
        expect(await draftParts(ref)).toEqual([]);
      });

      it("goes the way REST's discard goes, recording that the draft was discarded", async () => {
        // The shared discard path: the one that holds the document while it
        // removes the draft, and records the discard in the document's history.
        const ref = await withWorkingDraft(NOTES);
        await versions.deleteWorkingDraft(ref, null, asUser(editorId));
        const { items } = await versions.listEvents(
          { kind: "collection", slug: NOTES, id: ref.entryId },
          // The kind as history stores it.
          { kinds: ["draft-discarded"] }
        );
        expect(items.map(e => [e.actorKind, e.actorId])).toEqual([
          ["person", editorId],
        ]);
      });

      it("hands the discard's own read of the document the context the plugin passes", async () => {
        // The discard reads the live document before it removes the draft;
        // a hook that needs the caller's context there gets it.
        const ref = await withWorkingDraft(NOTES);
        const needsContext = (ctx: { context: Record<string, unknown> }) => {
          if (ctx.context.allow !== true) throw new Error("needs its context");
          return (ctx as { data?: unknown }).data;
        };
        registerHook("beforeRead", NOTES, needsContext as never);
        try {
          await versions.deleteWorkingDraft(ref, null, {
            ...asUser(editorId),
            context: { allow: true },
          });
        } finally {
          unregisterHook("beforeRead", NOTES, needsContext as never);
        }
        expect(await draftParts(ref)).toEqual([]);
      });

      it("is refused to an API key, whose own id a plugin cannot name, and the draft stays", async () => {
        const ref = await withWorkingDraft(NOTES);
        await expect(
          versions.deleteWorkingDraft(ref, null, {
            ...asUser(editorId),
            authenticatedScope: {
              actorType: "apiKey",
              permissions: [`read-${NOTES}`, `update-${NOTES}`],
            },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await draftParts(ref)).length).toBeGreaterThan(0);
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

      it("is refused to an API key, keeping the owner's own recovery point", async () => {
        // A recovery point is one row per document and author. A plugin does
        // not know a key's own id, so filing the key's under its owner would
        // overwrite the owner's unsaved work; the call is refused instead.
        const ref = refOf(NOTES, await published(NOTES, "v"));
        await versions.autosave(
          { ref, status: "draft", snapshot: { title: "owner's work" } },
          asUser(editorId)
        );
        await expect(
          versions.autosave(
            { ref, status: "draft", snapshot: { title: "by a key" } },
            {
              ...asUser(editorId),
              authenticatedScope: {
                actorType: "apiKey",
                permissions: [`read-${NOTES}`, `update-${NOTES}`],
              },
            }
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await versions.getAutosave(ref, editorId))?.snapshot).toEqual({
          title: "owner's work",
        });
      });

      it("takes any snapshot the store takes, a function or toJSON included", async () => {
        // The store keeps a snapshot as JSON, so a value JSON can write is
        // accepted, as it always was: a function is left out, and toJSON is
        // what is kept.
        const ref = refOf(NOTES, await published(NOTES, "t"));
        await versions.autosave({
          ref,
          status: "draft",
          snapshot: {
            title: "typing",
            draw: () => "not data",
            when: { toJSON: () => "2026-10-20" },
          },
          createdBy: ownerId,
        });
        expect((await versions.getAutosave(ref, ownerId))?.snapshot).toEqual({
          title: "typing",
          when: "2026-10-20",
        });
      });

      it("is filed under the caller when the call names no author", async () => {
        const ref = refOf(NOTES, await published(NOTES, "l"));
        await versions.autosave(
          { ref, status: "draft", snapshot },
          asUser(editorId)
        );
        expect(await versions.getAutosave(ref, editorId)).toBeDefined();
      });

      it("is refused when it names someone else as the author, and nothing is kept", async () => {
        const ref = refOf(NOTES, await published(NOTES, "m"));
        await expect(
          versions.autosave(
            { ref, status: "draft", snapshot, createdBy: ownerId },
            asUser(editorId)
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await versions.getAutosave(ref, ownerId)).toBeUndefined();
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

    describe("a recovery point's password values", () => {
      it("are left out, as REST leaves them out, for the plugin acting as itself", async () => {
        const ref = refOf(SECRETS, await published(SECRETS, "n"));
        const snapshot = { title: "typing", pin: "4321" };
        await versions.autosave({
          ref,
          status: "draft",
          snapshot,
          createdBy: ownerId,
        });
        const stored = await versions.getAutosave(ref, ownerId);
        expect(stored?.snapshot).toEqual({ title: "typing" });
        expect(snapshot, "the plugin's own object is not changed").toEqual({
          title: "typing",
          pin: "4321",
        });
      });

      it("are left out of a snapshot that is a list of rows", async () => {
        const ref = refOf(SECRETS, await published(SECRETS, "u"));
        await versions.autosave({
          ref,
          status: "draft",
          snapshot: [{ title: "typing", pin: "4321" }],
          createdBy: ownerId,
        });
        const stored = await versions.getAutosave(ref, ownerId);
        expect(stored?.snapshot).toEqual([{ title: "typing" }]);
      });

      it("are left out for a person the plugin acts for", async () => {
        const ref = refOf(SECRETS, await published(SECRETS, "o"));
        await versions.autosave(
          { ref, status: "draft", snapshot: { title: "typing", pin: "4321" } },
          asUser(editorId)
        );
        expect((await versions.getAutosave(ref, editorId))?.snapshot).toEqual({
          title: "typing",
        });
      });
    });

    describe("a page's history", () => {
      const snapshot = { blocks: [] };

      it("refuses a checked autosave, even to an editor, and keeps nothing", async () => {
        const ref = pageRef("page-a");
        await expect(
          versions.autosave(
            { ref, status: "draft", snapshot, createdBy: editorId },
            asUser(editorId)
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await versions.getAutosave(ref, editorId)).toBeUndefined();
      });

      it("refuses a checked discard, even to an editor", async () => {
        await expect(
          versions.deleteWorkingDraft(pageRef("page-b"), null, asUser(editorId))
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      });

      it("stays trusted for the plugin acting as itself", async () => {
        const ref = pageRef("page-c");
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
