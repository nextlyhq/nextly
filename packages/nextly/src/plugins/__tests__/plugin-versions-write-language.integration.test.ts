/**
 * A checked plugin history write tells the update rule the languages REST's
 * route tells it.
 *
 * REST judges a discard and an autosave in the language the request names,
 * kept as named, and naming a version in every language. A plugin's checked
 * write is judged the same: told every language, a rule that closes French
 * would refuse an English discard REST allows, and one open where French is
 * involved would allow an English discard REST refuses. A label is told every
 * language even when the plugin calls it from inside an operation in one, as
 * a hook on an English write would.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withRuleLanguage } from "../../auth/access/rule-language";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, text } from "../../config";
import {
  account,
  role,
  seedPermissions,
} from "../../direct-api/__tests__/checked-access-fixtures";
import type { VersionRef } from "../../domains/versions/versions-repository";
import type { AccessRuleContext } from "../../shared/types/access";
import type { AuthUserId } from "../../types/auth";
import { definePlugin } from "../index";
import type { ServiceOpts } from "../service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

/** Updatable in every language but French. */
const FRENCH_CLOSED = "plugin_history_french_closed";
/** Updatable only where French is involved. */
const FRENCH_INVOLVED = "plugin_history_french_involved";

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
      locale?: string | null;
    },
    opts?: ServiceOpts
  ): Promise<unknown>;
  get(ref: VersionRef, versionNo: number): Promise<{ label?: string | null }>;
  getAutosave(
    ref: VersionRef,
    createdBy: string | null
  ): Promise<{ snapshot: unknown } | undefined>;
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
  "a checked plugin history write is judged in REST's languages (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let versions: PluginVersions;
    let ownerId: string;
    let editorId: string;

    const probe = definePlugin({
      name: "@acme/history-write-language-probe",
      version: "1.0.0",
      nextly: ">=0.0.1",
      init: ctx => {
        versions = ctx.services.versions as unknown as PluginVersions;
      },
    });

    const asEditor = (): ServiceOpts => ({
      user: { id: editorId as AuthUserId, email: "editor@example.com" },
    });

    function handler(): Handler {
      return t.getService("collectionsHandler") as unknown as Handler;
    }

    function draftParts(ref: VersionRef): Promise<(string | null)[]> {
      return t.getService("versionsService").listWorkingDraftParts(ref);
    }

    /** A published document, made by trusted server code, with version 1. */
    async function published(slug: string): Promise<VersionRef> {
      const created = await handler().createEntry(
        { collectionName: slug, overrideAccess: true, user: { id: ownerId } },
        { title: "live", status: "published" }
      );
      return {
        scopeKind: "collection",
        scopeSlug: slug,
        entryId: created.data!.id,
      };
    }

    /** A published document with an unpublished English edit on top. */
    async function withEnglishDraft(slug: string): Promise<VersionRef> {
      const ref = await published(slug);
      await handler().updateEntry(
        {
          collectionName: slug,
          entryId: ref.entryId,
          locale: "en",
          overrideAccess: true,
          user: { id: ownerId },
        },
        { title: "edited" }
      );
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
        localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: FRENCH_CLOSED,
            localized: true,
            status: true,
            versions: { drafts: { autosave: true } },
            access: {
              read: () => true,
              update: ({ locales }: AccessRuleContext) =>
                !locales.includes("fr"),
            },
            fields: [text({ name: "title", localized: true })],
          }),
          defineCollection({
            slug: FRENCH_INVOLVED,
            localized: true,
            status: true,
            versions: { drafts: { autosave: true } },
            access: {
              read: () => true,
              update: ({ locales }: AccessRuleContext) =>
                locales.includes("fr"),
            },
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      });
      await seedPermissions(t);
      ownerId = await account(t, "owner@example.com");
      editorId = await account(t, "editor@example.com", [
        await role(t, "language-history-editors", [
          `read-${FRENCH_CLOSED}`,
          `update-${FRENCH_CLOSED}`,
          `read-${FRENCH_INVOLVED}`,
          `update-${FRENCH_INVOLVED}`,
        ]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("discarding a working draft", () => {
      it("is judged in the language it names: allowed in English where the rule closes French", async () => {
        const ref = await withEnglishDraft(FRENCH_CLOSED);
        await versions.deleteWorkingDraft(ref, "en", asEditor());
        expect(await draftParts(ref)).toEqual([]);
      });

      it("is refused in French where the rule closes French, and the draft stays", async () => {
        const ref = await withEnglishDraft(FRENCH_CLOSED);
        await expect(
          versions.deleteWorkingDraft(ref, "fr", asEditor())
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await draftParts(ref)).length).toBeGreaterThan(0);
      });

      it("is refused in English where the rule opens only where French is involved, and the draft stays", async () => {
        const ref = await withEnglishDraft(FRENCH_INVOLVED);
        await expect(
          versions.deleteWorkingDraft(ref, "en", asEditor())
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await draftParts(ref)).length).toBeGreaterThan(0);
      });
    });

    describe("recording an autosave", () => {
      const snapshot = { title: "typing" };

      it("is judged in the language it names: kept in English where the rule closes French", async () => {
        const ref = await published(FRENCH_CLOSED);
        await versions.autosave(
          { ref, status: "draft", snapshot, locale: "en" },
          asEditor()
        );
        expect(await versions.getAutosave(ref, editorId)).toBeDefined();
      });

      it("is refused in French where the rule closes French, and nothing is kept", async () => {
        const ref = await published(FRENCH_CLOSED);
        await expect(
          versions.autosave(
            { ref, status: "draft", snapshot, locale: "fr" },
            asEditor()
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await versions.getAutosave(ref, editorId)).toBeUndefined();
      });

      it("is refused in English where the rule opens only where French is involved, and nothing is kept", async () => {
        const ref = await published(FRENCH_INVOLVED);
        await expect(
          versions.autosave(
            { ref, status: "draft", snapshot, locale: "en" },
            asEditor()
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect(await versions.getAutosave(ref, editorId)).toBeUndefined();
      });
    });

    describe("naming a version", () => {
      it("is judged in every language, even called inside an operation in English", async () => {
        // As a hook on an English write would call it: REST's label route is
        // told every language, so the rule that closes French refuses it.
        const ref = await published(FRENCH_CLOSED);
        await expect(
          withRuleLanguage({ locale: "en", locales: ["en"] }, () =>
            versions.setLabel(ref, 1, "named", undefined, asEditor())
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await versions.get(ref, 1)).label ?? null).toBeNull();
      });
    });
  }
);
