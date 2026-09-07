/**
 * A stored read rule constrains ROWS, and the pending-edits cards must obey it.
 *
 * 🔴 `readableEntities` decides whether a collection is in reach AT ALL, and its
 * own contract says so -- the per-row rules of whatever query follows decide
 * which documents come back. A collection carrying a stored `owner-only` read
 * rule therefore passes that coarse check for every editor, while the ordinary
 * read path additionally filters to `created_by = caller`. A cross-document read
 * that stops at the collection name reports one author's documents to another:
 * the count includes them, and the list hands back their entry ids and the
 * instants they were edited.
 *
 * Written against a real database because the constraint only exists once the
 * access service has evaluated a STORED rule and the read path has turned it
 * into SQL; a fake collection cannot produce either.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { executeWidgetQuery } from "../../widgets/execute";
import { VERSIONS_SOURCE_ID } from "../../widgets/system-source-ids";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OWNER = "user-owner";
const OTHER = "user-other";

/** A working draft for one document, so it counts as a pending edit. */
function draft(
  entryId: string,
  scope: { kind: string; slug: string } = { kind: "collection", slug: "docs" }
) {
  return {
    id: crypto.randomUUID(),
    scopeKind: scope.kind,
    scopeSlug: scope.slug,
    entryId,
    versionNo: null,
    status: "draft",
    isAutosave: false,
    snapshot: JSON.stringify({ title: "unpublished" }),
    label: null,
    locale: null,
    sourceVersionNo: null,
    createdBy: null,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

/**
 * One collection under a stored owner-only read rule, with a pending edit on a
 * document owned by each of two users.
 *
 * The rule is written onto the collection row rather than declared in
 * `defineCollection`, because the stored shape (`accessRules`) is what the
 * access service reads; the code-first surface exposes `access` functions, which
 * return a verdict and never a row constraint.
 */
async function boot(
  dialect: TestDialect
): Promise<{ ownerEntry: string; otherEntry: string }> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "docs",
        versions: { drafts: true },
        // Code-defined access ADMITS the collection, so the coarse entity check
        // passes for a caller holding no stored grant. Without it `canReadEntity`
        // denies `docs` outright and every read below answers empty -- which
        // looks exactly like the row rule working and proves nothing.
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });

  await current.adapter.update(
    "dynamic_collections",
    { access_rules: { read: { type: "owner-only" } } },
    { and: [{ column: "slug", op: "=", value: "docs" }] }
  );

  const handler = current.getService("collectionsHandler");
  const made: Record<string, string> = {};
  for (const [key, userId] of [
    ["ownerEntry", OWNER],
    ["otherEntry", OTHER],
  ] as const) {
    const created = await handler.createEntry(
      { collectionName: "docs", user: { id: userId }, routeAuthorized: true },
      { title: `${userId} document` }
    );
    expect(created.success).toBe(true);
    made[key] = (created.data as { id: string }).id;
    await current.adapter.insert(VERSIONS_TABLE, draft(made[key]));
  }
  // 🔴 The control, and the reason this file can be believed. It establishes
  // BOTH halves of the fixture the assertions depend on: the coarse entity
  // check admits `docs` for this caller (or the ordinary read would be empty
  // too), and the stored rule genuinely constrains rows (or it would return
  // both). Without it, a versions read answering nothing is indistinguishable
  // from a collection the caller cannot reach at all -- which is what the first
  // draft of this test actually measured.
  const readable = await handler.listEntries({
    collectionName: "docs",
    user: { id: OWNER },
    routeAuthorized: true,
  });
  expect(readable.success).toBe(true);
  expect((readable.data!.docs as { id: string }[]).map(row => row.id)).toEqual([
    made.ownerEntry,
  ]);

  return { ownerEntry: made.ownerEntry!, otherEntry: made.otherEntry! };
}

const caller = { user: { id: OWNER, roles: ["editor"] } };

describe.each(getConfiguredTestDialects())(
  "pending edits under a stored read rule (%s)",
  dialect => {
    it("counts only the documents this caller may actually read", async () => {
      await boot(dialect);

      const result = await executeWidgetQuery(
        { source: VERSIONS_SOURCE_ID, op: "count" },
        caller
      );

      // Two documents hold a pending edit; the owner-only rule leaves this
      // caller able to read exactly one of them.
      expect(result).toMatchObject({ op: "count", total: 1 });
    });

    it("counts a document that has NEVER been published", async () => {
      // 🔴 The card exists to name unpublished work, and the newest of that is a
      // document nobody has published yet. The readability probe reads through
      // the ordinary path, which for a lifecycle collection defaults to
      // PUBLISHED rows -- so a probe that did not ask for every state would
      // report the caller's own brand-new draft as unreadable and drop it,
      // hiding exactly the work the reader opened the dashboard to find.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "docs",
            status: true,
            versions: { drafts: true },
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
      });

      const handler = current.getService("collectionsHandler");
      const created = await handler.createEntry(
        { collectionName: "docs", user: { id: OWNER }, routeAuthorized: true },
        { title: "never published", status: "draft" }
      );
      expect(created.success).toBe(true);
      const entryId = (created.data as { id: string }).id;
      await current.adapter.insert(VERSIONS_TABLE, draft(entryId));

      const result = await executeWidgetQuery(
        { source: VERSIONS_SOURCE_ID, op: "count" },
        caller
      );

      expect(result).toMatchObject({ op: "count", total: 1 });
    });

    it("counts a SINGLE's pending edit through the Singles read path", async () => {
      // 🔴 A `single` row is decided by a different path from a collection row —
      // a Single carries its own stored rules and, when localized, is a
      // different document per language. Its branch is also where the Singles
      // read path is reached, and that import is DEFERRED to keep the two
      // domains out of a module cycle, so a collection-only fixture never
      // executes it: the code would be loaded for the first time in production.
      current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({
            slug: "site-settings",
            versions: { drafts: true },
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
      });

      const singles = current.getService("singleEntryService");
      const document = await singles.get("site-settings", {
        overrideAccess: true,
      });
      expect(document.success).toBe(true);
      const entryId = (document.data as { id: string }).id;
      await current.adapter.insert(
        VERSIONS_TABLE,
        draft(entryId, { kind: "single", slug: "site-settings" })
      );

      const result = await executeWidgetQuery(
        { source: VERSIONS_SOURCE_ID, op: "count" },
        caller
      );

      expect(result).toMatchObject({ op: "count", total: 1 });
    });

    it("lists no document belonging to another author", async () => {
      const { ownerEntry, otherEntry } = await boot(dialect);

      const result = await executeWidgetQuery(
        { source: VERSIONS_SOURCE_ID, op: "list" },
        caller
      );
      const ids = (
        result as unknown as { items: { entryId: string }[] }
      ).items.map(item => item.entryId);

      // Asserted by IDENTITY, not by length: a list that dropped the caller's
      // own document and kept the other author's has the same size.
      expect(ids).toEqual([ownerEntry]);
      expect(ids).not.toContain(otherEntry);
    });
  }
);
