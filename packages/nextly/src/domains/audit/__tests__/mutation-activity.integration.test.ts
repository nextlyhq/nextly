/**
 * The activity trail is written by the mutation, not after it.
 *
 * The write this replaced ran from a post-commit hook, in its own transaction,
 * with its failure swallowed — so a change could commit and then fail to record,
 * leaving a content edit no entry describes and nothing to reconcile against.
 * These cases pin the two halves of the fix: an entry lands for a write, and a
 * write whose entry cannot be stored does not survive.
 *
 * Runs on whichever dialect the suite is pointed at. The failure that motivated
 * this was dialect-specific and invisible — the writer swallowed it — so nothing
 * here may depend on a single dialect's behaviour.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ActivityLogService } from "../../../services/dashboard/activity-log-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** An `activity_log` row as read back (Drizzle camelCases the columns). */
interface ActivityRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  action: string;
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  metadata: string | null;
  identityErasedAt: unknown;
}

const ACTOR = {
  id: "activity-actor",
  name: "Ada Lovelace",
  email: "ada@example.test",
};

async function activity(handle: TestNextly): Promise<ActivityRow[]> {
  return handle.adapter.select<ActivityRow>("activity_log");
}

/** The stored metadata, which is written as a JSON string. */
function metadataOf(row: ActivityRow): Record<string, unknown> {
  return row.metadata === null
    ? {}
    : (JSON.parse(row.metadata) as Record<string, unknown>);
}

/**
 * A harness with one collection and a real account for the actor.
 *
 * The account has to exist: the write decides whether to store a name by asking
 * whether the actor still has one, so an entry written for an absent account is
 * correctly born with its identity erased and would not prove anything about
 * the ordinary path.
 */
async function withActor(
  dialect: TestDialect,
  collections = [
    defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
  ]
): Promise<TestNextly> {
  const handle = await createTestNextly({ dialect, collections });
  await handle.adapter.insert("users", {
    id: ACTOR.id,
    name: ACTOR.name,
    email: ACTOR.email,
    is_active: true,
  });
  return handle;
}

function asActor(collectionName: string): {
  collectionName: string;
  overrideAccess: true;
  user: { id: string; email: string };
  actor: { type: "user"; id: string };
} {
  return {
    collectionName,
    overrideAccess: true,
    user: { id: ACTOR.id, email: ACTOR.email },
    actor: { type: "user", id: ACTOR.id },
  };
}

// Every dialect the environment can reach, never just the default. The failure
// this suite exists to catch was dialect-specific AND silent: the writer
// swallowed it, so an activity write that failed on one dialect left a passing
// suite and an empty trail.
describe.each(getConfiguredTestDialects())(
  "activity recorded by the mutation (%s)",
  dialect => {
    it("records the entry for a create, naming the actor from the account", async () => {
      current = await withActor(dialect);
      const handler = current.getService("collectionsHandler");

      const created = await handler.createEntry(asActor("posts"), {
        title: "hello",
      });
      const id = (created.data as { id: string }).id;

      const rows = await activity(current);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("create");
      expect(rows[0].collection).toBe("posts");
      expect(rows[0].entryId).toBe(id);
      expect(rows[0].entryTitle).toBe("hello");
      expect(rows[0].userId).toBe(ACTOR.id);
      // Resolved from the account by the write itself, not carried in: the caller
      // above passes no name at all, so a stored one can only have come from the
      // row the write read under its lock.
      expect(rows[0].userName).toBe(ACTOR.name);
      expect(rows[0].userEmail).toBe(ACTOR.email);
      expect(rows[0].identityErasedAt).toBeFalsy();
    });

    it("records a working-draft save, which changes no live document", async () => {
      // A status-less edit to a PUBLISHED entry on a drafts collection is stored
      // as a working draft: the live row is untouched, so no public event is
      // recorded and nothing a subscriber sees has changed. A person still
      // edited content, and the trail records people — this is the one place
      // the outbox and the trail legitimately disagree, and the edit was
      // missing from the trail when activity was recorded only where an event
      // was.
      current = await withActor(dialect, [
        defineCollection({
          slug: "posts",
          status: true,
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ]);
      const handler = current.getService("collectionsHandler");

      const created = await handler.createEntry(asActor("posts"), {
        title: "live",
        status: "published",
      });
      const id = (created.data as { id: string }).id;

      // No `status` key: that is what makes it accumulate onto the published
      // row as a draft rather than edit it in place.
      await handler.updateEntry(
        { ...asActor("posts"), entryId: id },
        { title: "draft edit" }
      );

      const updated = (await activity(current)).find(
        row => row.action === "update"
      );
      expect(updated).toBeDefined();
      expect(updated!.entryId).toBe(id);
      expect(metadataOf(updated!).changedFields).toContain("title");
    });

    it("records a bulk write, and attributes it to whoever performed it", async () => {
      // The in-transaction methods the bulk workers call resolved their actor
      // as `actorForWrite(undefined, params.user)` — discarding the transport
      // actor the bulk caller had already spread in, and reaching for a `user`
      // those methods are not given either. Every bulk and transaction write
      // therefore resolved to the SYSTEM actor, which the trail does not
      // record: the whole of bulk editing was missing from it.
      current = await withActor(dialect);
      const handler = current.getService("collectionsHandler");

      const created = await handler.createEntry(asActor("posts"), {
        title: "before",
      });
      const id = (created.data as { id: string }).id;

      await handler.bulkUpdateEntries({
        collectionName: "posts",
        ids: [id],
        data: { title: "edited in bulk" },
        overrideAccess: true,
        user: { id: ACTOR.id, email: ACTOR.email },
        actor: { type: "user", id: ACTOR.id },
      });

      // Sorted: the read places no ORDER BY, and the dialects genuinely differ
      // on what order they hand back. Only the SET of actions is the claim.
      const rows = await activity(current);
      expect(rows.map(row => row.action).sort()).toEqual(["create", "update"]);
      const updated = rows.find(row => row.action === "update");
      expect(updated!.userId).toBe(ACTOR.id);
      expect(updated!.entryId).toBe(id);
    });

    it("does not attribute an API-key bulk write to the key's owner", async () => {
      // The same seam, with the transport actor now honoured: a key is not a
      // person, and the trail's actor column is an account reference. Recording
      // API-key writes properly needs an actor-kind column; inventing the key's
      // OWNER as the author is the one thing it must not do meanwhile.
      current = await withActor(dialect);
      const handler = current.getService("collectionsHandler");

      const created = await handler.createEntry(asActor("posts"), {
        title: "before",
      });
      const id = (created.data as { id: string }).id;

      await handler.bulkUpdateEntries({
        collectionName: "posts",
        ids: [id],
        data: { title: "by the key" },
        overrideAccess: true,
        user: { id: ACTOR.id, email: ACTOR.email },
        actor: { type: "apiKey", id: "key_bulk_probe" },
      });

      expect((await activity(current)).map(row => row.action)).toEqual([
        "create",
      ]);
    });

    it("stores which fields an update changed, as names and never values", async () => {
      current = await withActor(dialect);
      const handler = current.getService("collectionsHandler");

      const created = await handler.createEntry(asActor("posts"), {
        title: "before",
      });
      const id = (created.data as { id: string }).id;
      await handler.updateEntry(
        { ...asActor("posts"), entryId: id },
        { title: "after" }
      );

      const rows = await activity(current);
      const updated = rows.find(row => row.action === "update");
      expect(updated).toBeDefined();
      expect(metadataOf(updated!).changedFields).toContain("title");
      // The contract that makes the trail cheap to keep and safe to export: the
      // stored metadata names the field and carries neither of its values.
      expect(updated!.metadata).not.toContain("before");
      expect(updated!.metadata).not.toContain("after");
    });

    it("records nothing for the create's own keys, which say nothing an action does not", async () => {
      current = await withActor(dialect);
      const handler = current.getService("collectionsHandler");

      await handler.createEntry(asActor("posts"), { title: "hello" });

      const rows = await activity(current);
      expect(metadataOf(rows[0]).changedFields).toBeUndefined();
    });

    it("takes the content change down with it when the entry cannot be stored", async () => {
      // The defect this closes: the previous writer ran after the commit and
      // swallowed its own failure, so this case committed the change and recorded
      // nothing, silently. Asserting the write REJECTS is not enough on its own —
      // the row must also be absent, which is what makes it one transaction
      // rather than two that happen to fail together.
      current = await withActor(dialect);
      const handler = current.getService("collectionsHandler");
      const service = container.get<ActivityLogService>("activityLogService");
      const failure = new Error("activity trail unavailable");
      service.logActivityInTx = () => Promise.reject(failure);

      const result = await handler.createEntry(asActor("posts"), {
        title: "doomed",
      });
      expect(result.success).toBe(false);

      const entries = await current.nextly.find({ collection: "posts" });
      expect(entries.items).toHaveLength(0);
      expect(await activity(current)).toHaveLength(0);
    });

    it("leaves no entry for a write no account performed", async () => {
      // Seeds, migrations and internal maintenance carry no person to attribute
      // to, and the trail's actor column is a user reference: filing one of these
      // under an id no account owns would read as an already-erased identity.
      current = await withActor(dialect);
      const handler = current.getService("collectionsHandler");

      await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        { title: "by the system" }
      );

      expect(await activity(current)).toHaveLength(0);
    });

    it("leaves no entry for a collection hidden from the admin", async () => {
      current = await withActor(dialect, [
        defineCollection({
          slug: "posts",
          admin: { hidden: true },
          fields: [text({ name: "title" })],
        }),
      ]);
      const handler = current.getService("collectionsHandler");

      await handler.createEntry(asActor("posts"), { title: "internal" });

      expect(await activity(current)).toHaveLength(0);
    });
  }
);
