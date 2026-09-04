/**
 * Whether the activity feed obeys a collection's stored read rule.
 *
 * 🔴 The feed's scope is COLLECTION-level (`ReadableResources`), and its rows
 * carry `entryTitle` denormalised at write time rather than hydrated through the
 * read path — so nothing between the log table and the response consults a
 * document rule. A collection carrying a stored `owner-only` read rule admits
 * every editor at the coarse check while the ordinary read path narrows to a
 * subset, which is the same second axis the pending-edit cards were repaired
 * for.
 *
 * This file settles that by measurement rather than by reading the query,
 * because "there is no filter here" is exactly the kind of claim that is true
 * of the code you looked at and false of the system. It failed when written,
 * returning the other author's title, and is kept as the regression.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { someResources } from "../readable-resources";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OWNER = "user-owner";
const OTHER = "user-other";

/** One logged edit, as the audit writer stores it. */
function activityRow(patch: {
  userId: string;
  entryId: string;
  entryTitle: string;
}) {
  return {
    id: crypto.randomUUID(),
    userId: patch.userId,
    userName: patch.userId,
    userEmail: `${patch.userId}@example.test`,
    action: "update",
    collection: "docs",
    entryId: patch.entryId,
    entryTitle: patch.entryTitle,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    identityErasedAt: null,
  };
}

describe.each(getConfiguredTestDialects())(
  "activity feed under a stored read rule (%s)",
  dialect => {
    it("does not report entry titles for documents the caller cannot read", async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "docs",
            // Code-defined access ADMITS the collection, so the coarse check
            // passes for a caller holding no stored grant — without it the feed
            // is empty for a reason that has nothing to do with document rules.
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
        ["owner", OWNER],
        ["other", OTHER],
      ] as const) {
        const created = await handler.createEntry(
          {
            collectionName: "docs",
            user: { id: userId },
            routeAuthorized: true,
          },
          { title: `${userId} document` }
        );
        expect(created.success).toBe(true);
        made[key] = (created.data as { id: string }).id;
      }

      // 🔴 The control. It establishes both halves the assertion depends on:
      // the coarse check admits `docs` for this caller, and the stored rule
      // genuinely narrows rows. Without it, an empty feed and a correctly
      // filtered feed look identical.
      const readable = await handler.listEntries({
        collectionName: "docs",
        user: { id: OWNER },
        routeAuthorized: true,
      });
      expect(readable.success).toBe(true);
      expect((readable.data!.docs as { id: string }[]).map(r => r.id)).toEqual([
        made.owner,
      ]);

      await current.adapter.insert(
        "activity_log",
        activityRow({
          userId: OWNER,
          entryId: made.owner!,
          entryTitle: "owner document",
        })
      );
      await current.adapter.insert(
        "activity_log",
        activityRow({
          userId: OTHER,
          entryId: made.other!,
          entryTitle: "SECRET other-author document",
        })
      );

      // No explicit type argument: `getService` is keyed on `ServiceMap`, which
      // already maps this name to `ActivityLogService`. Naming the type again
      // does not narrow anything -- it supplies a type where a KEY is expected,
      // and the resulting `unknown` cascades into every use below.
      const activity = current.getService("activityLogService");
      const feed = await activity.getRecentActivity({
        scope: someResources(["docs"]),
        caller: { user: { id: OWNER, roles: [] } },
      });

      const titles = feed.activities.map(row => row.entryTitle).sort();
      // Both of the other author's rows must be absent, not just the one this
      // test inserted: creating an entry logs its own activity row, so the
      // ordinary product path produces a second disclosure of the same title.
      expect(titles).not.toContain("SECRET other-author document");
      expect(titles).not.toContain("user-other document");
      // Asserted as the WHOLE list rather than by absence: a feed that returned
      // nothing at all would satisfy both refusals above and prove nothing.
      expect(titles).toEqual(["owner document", "user-owner document"]);
    });
  }
);
