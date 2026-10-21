/**
 * A checked plugin label asks REST's question about the version's language.
 *
 * A version is named in its own language's history, so the caller must be
 * able to read that language before it is named or handed back, as the REST
 * label route asks. No rule can refuse a language yet, so the gate is watched
 * at its boundary: refused there, the label is refused and nothing is written;
 * allowed, it is asked about the version being named.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, text } from "../../config";
import {
  account,
  role,
  seedPermissions,
} from "../../direct-api/__tests__/checked-access-fixtures";
import type { VersionRef } from "../../domains/versions/versions-repository";
import { NextlyError } from "../../errors/nextly-error";
import type { AuthUserId } from "../../types/auth";
import { definePlugin } from "../index";
import type { ServiceOpts } from "../service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

/** The version whose language the gate refuses, set by a case. */
const refuse = vi.hoisted(() => ({ versionOf: "" }));
const asked = vi.hoisted(() => ({ versions: [] as number[] }));

vi.mock("../../api/versions-access", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../api/versions-access")>();
  return {
    ...actual,
    assertVersionLanguageReadable: vi.fn(
      async (document: { entryId: string }, versionNo: number) => {
        asked.versions.push(versionNo);
        if (document.entryId === refuse.versionOf) {
          throw NextlyError.notFound({
            logContext: { reason: "test-language-refused" },
          });
        }
        return null;
      }
    ),
  };
});

const NOTES = "plugin_history_language";

interface PluginVersions {
  setLabel(
    ref: VersionRef,
    versionNo: number,
    label: string | null,
    by?: unknown,
    opts?: ServiceOpts
  ): Promise<unknown>;
  get(ref: VersionRef, versionNo: number): Promise<{ label?: string | null }>;
}

describe.each(getConfiguredTestDialects())(
  "a checked plugin label asks about the version's language (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let versions: PluginVersions;
    let ownerId: string;
    let editorId: string;

    const probe = definePlugin({
      name: "@acme/history-language-probe",
      version: "1.0.0",
      nextly: ">=0.0.1",
      init: ctx => {
        versions = ctx.services.versions as unknown as PluginVersions;
      },
    });

    const asEditor = (): ServiceOpts => ({
      user: { id: editorId as AuthUserId, email: "editor@example.com" },
    });

    async function published(title: string): Promise<VersionRef> {
      const handler = t.getService("collectionsHandler") as unknown as {
        createEntry(
          params: Record<string, unknown>,
          data: Record<string, unknown>
        ): Promise<{ data: { id: string } | null }>;
      };
      const created = await handler.createEntry(
        { collectionName: NOTES, overrideAccess: true, user: { id: ownerId } },
        { title, status: "published" }
      );
      return {
        scopeKind: "collection",
        scopeSlug: NOTES,
        entryId: created.data!.id,
      };
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [probe],
        collections: [
          defineCollection({
            slug: NOTES,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      await seedPermissions(t);
      ownerId = await account(t, "owner@example.com");
      editorId = await account(t, "editor@example.com", [
        await role(t, "language-editors", [`read-${NOTES}`, `update-${NOTES}`]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("is refused, writing nothing, when the version's language is refused", async () => {
      const ref = await published("refused language");
      refuse.versionOf = ref.entryId;
      try {
        await expect(
          versions.setLabel(ref, 1, "named", undefined, asEditor())
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        refuse.versionOf = "";
      }
      expect((await versions.get(ref, 1)).label ?? null).toBeNull();
    });

    it("asks about the version it names, and names it when allowed", async () => {
      const ref = await published("allowed language");
      asked.versions.length = 0;
      await versions.setLabel(ref, 1, "named", undefined, asEditor());
      expect(asked.versions).toEqual([1]);
      expect((await versions.get(ref, 1)).label).toBe("named");
    });
  }
);
