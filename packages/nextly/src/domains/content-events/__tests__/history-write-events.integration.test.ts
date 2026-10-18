/**
 * Naming a version, discarding a working draft and a retention pass each
 * record their event in the document's history, on every dialect, in the
 * transaction that makes the change: a name by who gave it, a discard only
 * when there was a draft to discard, and a retention pass once, with how many
 * versions it removed, by the system.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  id: string;
  subjectId: string;
  kind: string;
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  versionNo: number | null;
  payload: unknown;
}

const ANA = { id: "user-ana", name: "Ana", email: "ana@x.test", role: "admin" };

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "notes",
        versions: true,
        fields: [text({ name: "title" })],
      }),
      // A published document holds an edit as its working draft.
      defineCollection({
        slug: "articles",
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "kept",
        versions: { maxPerDoc: 2 },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const handler = current.getService("collectionsHandler");
  const as = { overrideAccess: true, user: ANA };
  const create = async (
    collectionName: string,
    data: Record<string, unknown>
  ) =>
    (
      (await handler.createEntry({ collectionName, ...as }, data)).data as {
        id: string;
      }
    ).id;
  const update = (
    collectionName: string,
    entryId: string,
    data: Record<string, unknown>
  ) => handler.updateEntry({ collectionName, entryId, ...as }, data);
  const eventsOf = async (id: string) =>
    (await current!.adapter.select<EventRow>("nextly_content_events"))
      .filter(row => row.subjectId === id)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  /** A payload as stored: MySQL can return a JSON column as text. */
  const payloadOf = (event: EventRow | undefined) =>
    typeof event?.payload === "string"
      ? (JSON.parse(event.payload) as unknown)
      : event?.payload;
  return { handler, create, update, eventsOf, payloadOf };
}

describe.each(getConfiguredTestDialects())(
  "naming, discarding and retention in a document's history (integration, %s)",
  dialect => {
    it("records a version given a name, by who named it, and nothing for clearing one", async () => {
      const t = await boot(dialect);
      const id = await t.create("notes", { title: "a" });
      const versions = current!.getService("versionsService");
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: "notes",
        entryId: id,
      };
      const by = {
        actor: { type: "user" as const, id: ANA.id },
        personName: "Ana",
      };

      await versions.setLabel(ref, 1, "Launch copy", by);
      await versions.setLabel(ref, 1, null, by);

      const named = (await t.eventsOf(id)).filter(e => e.kind === "named");
      expect(named).toHaveLength(1);
      expect(named[0]).toMatchObject({
        actorKind: "person",
        actorId: ANA.id,
        actorName: "Ana",
        versionNo: 1,
      });
      expect(t.payloadOf(named[0])).toEqual({ label: "Launch copy" });
    }, 120_000);

    it("records discarding a working draft, and nothing when there was none", async () => {
      const t = await boot(dialect);
      const id = await t.create("articles", {
        title: "live",
        status: "published",
      });
      await t.update("articles", id, { title: "held edit" });

      await t.handler.discardWorkingDraft({
        collectionName: "articles",
        entryId: id,
        user: ANA,
      });
      // Nothing left to discard.
      await t.handler.discardWorkingDraft({
        collectionName: "articles",
        entryId: id,
        user: ANA,
      });

      const discarded = (await t.eventsOf(id)).filter(
        e => e.kind === "draft-discarded"
      );
      expect(discarded).toHaveLength(1);
      expect(discarded[0]).toMatchObject({
        actorKind: "person",
        actorName: "Ana",
      });
    }, 120_000);

    it("records a retention pass once, with how many versions it removed, by the system", async () => {
      const t = await boot(dialect);
      const id = await t.create("kept", { title: "1" });
      await t.update("kept", id, { title: "2" });
      await t.update("kept", id, { title: "3" });
      await t.update("kept", id, { title: "4" });

      const removals = (await t.eventsOf(id)).filter(
        e => e.kind === "versions-removed"
      );
      // Two passes past the cap of 2, each removing one version.
      expect(removals).toHaveLength(2);
      for (const removal of removals) {
        expect(removal).toMatchObject({ actorKind: "system", actorId: null });
        expect(t.payloadOf(removal)).toEqual({ count: 1 });
      }
    }, 120_000);
  }
);
