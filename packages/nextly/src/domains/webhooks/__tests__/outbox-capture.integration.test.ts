/**
 * Outbox capture on collection writes.
 *
 * Proves the mutation seam appends a `nextly_events` row for a content change:
 * the event carries the assembled read-shape document, secret fields never
 * reach the payload, and the row is written for versioned and non-versioned
 * collections alike (webhooks are independent of versioning).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fieldGroup,
  defineCollection,
  defineFieldGroup,
  password,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { NextlyError } from "../../../errors";
import type { CollectionService } from "../../collections/services/collection-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  resetWebhookActivation,
  setWebhookAuditEnabled,
} from "../recording-activation";
import { recordEvent } from "../record-event";
import { recordMutationEvent } from "../record-mutation-event";
import type { WebhookEvent } from "../types";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // The recording gates are process-global and this config runs every
  // integration file in ONE fork, so a test that turns the audit seam on would
  // otherwise leave it on for every file that runs after it — which changes
  // both what gets recorded and which retention window prunes it.
  resetWebhookActivation();
  // The post-commit-hook cases silence `console.error` to assert against it.
  // This config does not restore mocks between tests, so without this every
  // later test in the file would run with errors muted.
  vi.restoreAllMocks();
});

/** A `nextly_events` row as read back (Drizzle camelCases the columns). */
interface EventRow {
  id: string;
  type: string;
  resourceKind: string;
  resourceCollection: string | null;
  resourceId: string | null;
  payload: unknown;
  actorType: string | null;
  actorId: string | null;
  outcome: string;
  retentionClass: string;
}

/**
 * The stored envelope. The payload is written as a JSON string for cross-dialect
 * safety and comes back through the column's json codec, which parses it on some
 * dialects and not others — so accept either.
 */
function envelopeOf(row: EventRow): WebhookEvent {
  return (
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload
  ) as WebhookEvent;
}

/**
 * The error the registry logged alongside its phase line.
 *
 * `console.error` is called with the phase line AND the normalized exception,
 * so an assertion that reads only the first argument cannot tell a logged
 * failure from a logged label. `normalizeHookError` wraps an untyped throw, so
 * the thrown text arrives as the wrapper's `cause` rather than its message; a
 * typed throw arrives as itself, carrying its `logContext`. All three are
 * rendered so a test can name the original failure whichever way it was thrown.
 */
function loggedFailure(spy: { mock: { calls: unknown[][] } }): string {
  const error = spy.mock.calls[0]?.[1];
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const context = (error as { logContext?: unknown } | undefined)?.logContext;
  return `${String(error)} ${String(cause ?? "")} ${JSON.stringify(context ?? {})}`;
}

async function events(handle: TestNextly): Promise<EventRow[]> {
  return handle.adapter.select<EventRow>("nextly_events");
}

describe("webhook outbox capture (integration)", () => {
  it("records an audit-relevant row under the audit retention window", async () => {
    // The column defaults to "webhook", so asserting "audit" cannot pass by
    // default — it arrives only if the recording path classified the row and
    // carried the class through. Audit history outlives outbox hygiene, so a
    // row admitted by the audit seam must not be pruned on the delivery clock.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          access: { read: () => true, create: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    setWebhookAuditEnabled(true);

    await current.nextly.create({
      collection: "posts",
      data: { title: "hello" },
    });

    const rows = await events(current);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.retentionClass === "audit")).toBe(true);
  });

  it("stores a non-default outcome through the real schema", async () => {
    // Asserting the DEFAULT here would prove nothing: the column defaults to
    // "success", so a recorder that dropped the field entirely would still read
    // back as one. Recording a REFUSAL is what separates the two — it can only
    // arrive if the recorder carries the value and the column accepts it.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          access: { read: () => true, create: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const envelope: WebhookEvent = {
      id: "evt_outcome_1",
      type: "entry.updated",
      specversion: "1",
      timestamp: new Date().toISOString(),
      resource: { kind: "entry", collection: "posts", id: "p1" },
      data: {},
      previous: null,
      changedFields: [],
      outcome: "failure",
    };
    await current.adapter.transaction(async tx =>
      recordEvent(tx, { envelope })
    );

    const rows = await events(current);
    const recorded = rows.find(row => row.id === "evt_outcome_1");
    expect(recorded).toBeDefined();
    expect(recorded!.outcome).toBe("failure");
  });

  it("records entry.created carrying the assembled document when versioning is OFF", async () => {
    // Versioning off is the case that regressed before: the document assembly
    // used to live inside the versioning branch, so nothing was available to
    // build an envelope from.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello" }
    );
    const id = (created.data as { id: string }).id;

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("entry.created");
    expect(rows[0].resourceKind).toBe("entry");
    expect(rows[0].resourceCollection).toBe("posts");
    expect(rows[0].resourceId).toBe(id);

    const envelope = envelopeOf(rows[0]);
    expect(envelope.data.title).toBe("hello");
    // Create has no prior state, and every present key counts as changed.
    expect(envelope.previous).toBeNull();
    expect(envelope.changedFields).toContain("title");
    expect(envelope.resource).toMatchObject({
      kind: "entry",
      collection: "posts",
    });
  });

  it("flags eventRecorded when the write commits but a post-commit hook throws", async () => {
    // The event is appended inside the write transaction; afterCreate hooks run
    // after it commits, so a throw there cannot undo either. The write reports
    // success and the hook failure is reported separately — raising it instead
    // would describe a durable row as a failure and invite a retry that writes a
    // second one. `eventRecorded` is what the fast drain + retention key off, and
    // it stays true independently of how the hook fared.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    current.hooks.register("afterCreate", "posts", () => {
      throw new Error("afterCreate observer failed");
    });

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello" }
    );

    // The entry + event committed, and that is what the caller is told.
    expect(created.success).toBe(true);
    expect(created.eventRecorded).toBe(true);

    // Asserted, not merely allowed to happen: the operation reports success, so
    // this log is the only trace an operator gets. Dropping the assertion would
    // let a regression that swallows the hook error entirely still pass.
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0][0])).toContain("afterCreate");
    // The exception, not only the phase line: an implementation that logged
    // the label and dropped the error would satisfy the assertion above while
    // losing the operator's only diagnostic for a write reported successful.
    expect(loggedFailure(logged)).toContain("afterCreate observer failed");

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("entry.created");
  });

  it("flags eventRecorded on a bulk result when a committed item's hook throws", async () => {
    // A bulk delete runs each item through the per-item mutation, which commits
    // the row + event and then runs afterDelete. The item counts as a success
    // because it IS one — the row is gone and the event durable — and a batch
    // that counted it a failure would invite a retry against a row that no
    // longer exists. `eventRecorded` stays true so the batch still drains.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "hello" }
    );
    const id = (created.data as { id: string }).id;

    current.hooks.register("afterDelete", "posts", () => {
      throw new Error("afterDelete observer failed");
    });

    const result = await handler.bulkDeleteEntries({
      collectionName: "posts",
      ids: [id],
      overrideAccess: true,
    });

    // The delete + event committed, so the item counts as done.
    expect(result.successCount).toBe(1);
    expect(result.eventRecorded).toBe(true);

    // The hook failure still has to leave a trace, or a batch could report a
    // clean run while every item's side effect quietly broke.
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0][0])).toContain("afterDelete");
    // The exception, not only the phase line: an implementation that logged
    // the label and dropped the error would satisfy the assertion above while
    // losing the operator's only diagnostic for a write reported successful.
    expect(loggedFailure(logged)).toContain("afterDelete observer failed");

    const rows = await events(current);
    expect(rows.map(r => r.type).sort()).toEqual([
      "entry.created",
      "entry.deleted",
    ]);
  });

  it("records the event for a versioned collection too (one assembly, both consumers)", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    expect(envelopeOf(rows[0]).data.title).toBe("v1");
    // The version snapshot still lands alongside it.
    const versions = await current.adapter.select("nextly_versions");
    expect(versions).toHaveLength(1);
  });

  it("never ships a secret field in the payload", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "accounts",
          fields: [text({ name: "title" }), password({ name: "secret" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "accounts", overrideAccess: true },
      { title: "acct", secret: "SuperSecret123!" }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    const envelope = envelopeOf(rows[0]);
    expect(envelope.data.title).toBe("acct");
    // Neither the value nor the field name survives into the envelope.
    expect(envelope.data).not.toHaveProperty("secret");
    expect(envelope.changedFields).not.toContain("secret");
    expect(JSON.stringify(envelope)).not.toContain("SuperSecret123!");
  });

  it("never ships a hidden field declared inside a component", async () => {
    // A component reference names its target by slug and carries no inline
    // children, so the secret walk cannot see fields declared inside the
    // component unless the reference is expanded first. Without that expansion
    // this value ships in cleartext.
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "profile",
          fields: [
            text({ name: "heading" }),
            text({ name: "internalNote", admin: { hidden: true } }),
          ],
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "profile", component: "profile" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      {
        title: "page",
        profile: { heading: "shown", internalNote: "CONFIDENTIAL_NOTE" },
      }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    const envelope = envelopeOf(rows[0]);
    // The visible component value survives...
    expect((envelope.data.profile as { heading?: string })?.heading).toBe(
      "shown"
    );
    // ...but the hidden one never leaves the system, at any depth.
    expect(JSON.stringify(envelope)).not.toContain("CONFIDENTIAL_NOTE");
    expect(
      (envelope.data.profile as { internalNote?: string })?.internalNote
    ).toBeUndefined();
  });

  it("records entry.updated with a real prior document and an accurate diff", async () => {
    // The prior state must be read BEFORE the write: everything the update path
    // reads afterwards already reflects the new values, so sourcing `previous`
    // from it would make it equal `data` and leave changedFields empty —
    // silently breaking every changed-field filter.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "before", body: "unchanged" }
    );
    const id = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { title: "after" }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(2);
    const updated = rows.find(r => r.type === "entry.updated");
    expect(updated).toBeDefined();
    const envelope = envelopeOf(updated!);

    expect(envelope.data.title).toBe("after");
    // Genuinely prior state, not a copy of `data`.
    expect(envelope.previous).not.toBeNull();
    expect(envelope.previous?.title).toBe("before");
    // Only the field that actually moved is reported as changed.
    expect(envelope.changedFields).toContain("title");
    expect(envelope.changedFields).not.toContain("body");
  });

  it("attributes the event to the acting identity, including an API key", async () => {
    // An API-key write must attribute to the key itself, not to the user that
    // owns it: durable history that says "a person did this" when a token did
    // is worse than no attribution.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    await handler.createEntry(
      {
        collectionName: "posts",
        overrideAccess: true,
        actor: { type: "apiKey", id: "key_abc" },
      },
      { title: "by key" }
    );

    const rows = await events(current);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("apiKey");
    expect(rows[0].actorId).toBe("key_abc");
    expect(envelopeOf(rows[0]).actor).toEqual({
      type: "apiKey",
      id: "key_abc",
    });
  });

  it("keeps the acting identity through the duplicate and bulk-update wrappers", async () => {
    // These routes reach the instrumented create/update, so they DO record
    // events — which makes a dropped actor worse than a missing one: the row
    // says a person performed a write that a token performed. `actorForWrite`
    // cannot recover it, since it only sees what the wrapper forwarded.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const actor = { type: "apiKey" as const, id: "key_wrapper" };

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true, actor },
      { title: "original" }
    );
    const id = (created.data as { id: string }).id;

    await handler.duplicateEntry({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
      actor,
    });
    await handler.bulkUpdateEntries({
      collectionName: "posts",
      ids: [id],
      data: { title: "bulk-updated" },
      overrideAccess: true,
      actor,
    });

    const rows = await events(current);
    // The original create, the duplicate's create, and the bulk update.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.actorType).toBe("apiKey");
      expect(row.actorId).toBe("key_wrapper");
    }
  });

  it("records entry.deleted carrying the removed document, and the row is gone", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "doomed" }
    );
    const id = (created.data as { id: string }).id;

    const result = await handler.deleteEntry({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
    });
    expect(result.success).toBe(true);

    const rows = await events(current);
    const deleted = rows.find(r => r.type === "entry.deleted");
    expect(deleted).toBeDefined();
    expect(deleted!.resourceKind).toBe("entry");
    expect(deleted!.resourceCollection).toBe("posts");
    expect(deleted!.resourceId).toBe(id);

    const envelope = envelopeOf(deleted!);
    // The removed document's final state ships as `data`; there is no
    // post-delete state, so `previous` is null. The event is appended after the
    // row delete in the same transaction, so its presence proves the delete
    // committed.
    expect(envelope.data.title).toBe("doomed");
    expect(envelope.previous).toBeNull();
  });

  it("never ships a secret field in the delete payload", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "accounts",
          fields: [text({ name: "title" }), password({ name: "secret" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "accounts", overrideAccess: true },
      { title: "acct", secret: "SuperSecret123!" }
    );
    const id = (created.data as { id: string }).id;

    await handler.deleteEntry({
      collectionName: "accounts",
      entryId: id,
      overrideAccess: true,
    });

    const rows = await events(current);
    const deleted = rows.find(r => r.type === "entry.deleted");
    const envelope = envelopeOf(deleted!);
    expect(envelope.data.title).toBe("acct");
    expect(envelope.data).not.toHaveProperty("secret");
    expect(JSON.stringify(envelope)).not.toContain("SuperSecret123!");
  });

  it("never ships a hidden component field in the delete payload", async () => {
    // The delete payload is assembled with the same component population as the
    // create/update events, so a field hidden inside a component must be stripped
    // there too — otherwise a delete would leak what a create never did.
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "profile",
          fields: [
            text({ name: "heading" }),
            text({ name: "internalNote", admin: { hidden: true } }),
          ],
        }),
      ],
      collections: [
        defineCollection({
          slug: "pages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "profile", component: "profile" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      {
        title: "page",
        profile: { heading: "shown", internalNote: "CONFIDENTIAL_NOTE" },
      }
    );
    const id = (created.data as { id: string }).id;

    await handler.deleteEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });

    const rows = await events(current);
    const deleted = rows.find(r => r.type === "entry.deleted");
    const envelope = envelopeOf(deleted!);
    // The component's visible value is in the removed document...
    expect((envelope.data.profile as { heading?: string })?.heading).toBe(
      "shown"
    );
    // ...but the hidden one never leaves the system, even on delete.
    expect(JSON.stringify(envelope)).not.toContain("CONFIDENTIAL_NOTE");
  });

  it("attributes the delete to the acting identity, including an API key", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "by key" }
    );
    const id = (created.data as { id: string }).id;

    await handler.deleteEntry({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
      actor: { type: "apiKey", id: "key_del" },
    });

    const rows = await events(current);
    const deleted = rows.find(r => r.type === "entry.deleted");
    expect(deleted!.actorType).toBe("apiKey");
    expect(deleted!.actorId).toBe("key_del");
    expect(envelopeOf(deleted!).actor).toEqual({
      type: "apiKey",
      id: "key_del",
    });
  });

  it("attributes each bulk-deleted entry's event to the acting API key", async () => {
    // The REST bulk delete fans out to the single-entry delete, which now emits
    // entry.deleted; the actor must be threaded through the bulk stack too, or
    // every bulk-delete event is misattributed to the key owner or system.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const a = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "a" }
    );
    const b = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "b" }
    );
    const ids = [(a.data as { id: string }).id, (b.data as { id: string }).id];

    await handler.bulkDeleteEntries({
      collectionName: "posts",
      ids,
      overrideAccess: true,
      actor: { type: "apiKey", id: "key_bulk" },
    });

    const rows = await events(current);
    const deletes = rows.filter(r => r.type === "entry.deleted");
    expect(deletes).toHaveLength(2);
    for (const row of deletes) {
      expect(row.actorType).toBe("apiKey");
      expect(row.actorId).toBe("key_bulk");
    }
  });

  it("emits entry.deleted from the transactional delete helper too", async () => {
    // The batch/cascade delete paths go through the transactional helpers rather
    // than the single-delete method, so they must record the event as well — a
    // delete that removes rows silently is invisible to subscribers.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "tx-del" }
    );
    const id = (created.data as { id: string }).id;

    const collectionService =
      current.getService<CollectionService>("collectionService");
    // Pass an API-key actor through the public transactional wrapper: it must
    // forward to the event rather than falling back to the key owner or system.
    await current.adapter.transaction(async tx =>
      collectionService.deleteEntryInTransaction(
        tx,
        "posts",
        id,
        {},
        {
          type: "apiKey",
          id: "key_tx",
        }
      )
    );

    const rows = await events(current);
    const deleted = rows.find(r => r.type === "entry.deleted");
    expect(deleted).toBeDefined();
    expect(deleted!.resourceId).toBe(id);
    expect(envelopeOf(deleted!).data.title).toBe("tx-del");
    expect(deleted!.actorType).toBe("apiKey");
    expect(deleted!.actorId).toBe("key_tx");
  });

  it("writes the event inside the caller's transaction, so a rollback drops it", async () => {
    // The outbox guarantee: an event must never outlive the change it describes,
    // or a webhook fires for something that never happened. Recording through the
    // caller's transaction handle is what enforces that, so roll one back and
    // assert the event went with it.
    current = await createTestNextly({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
    });

    await expect(
      current.adapter.transaction(async tx => {
        await recordMutationEvent(tx, {
          type: "entry.created",
          resource: { kind: "entry", collection: "posts", id: "entry-1" },
          data: { title: "rolled back" },
          fields: [{ name: "title", type: "text" }],
        });
        throw NextlyError.internal({
          logContext: { reason: "force-rollback" },
        });
      })
      // The adapter wraps a failure raised inside a transaction, so assert only
      // that the transaction rejected — the rollback is what this test is about.
    ).rejects.toBeDefined();

    expect(await events(current)).toHaveLength(0);
  });
});
