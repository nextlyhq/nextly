/**
 * What a collection publish owes an edit it is not allowed to publish.
 *
 * A publish folds the held working draft into the live row and then DELETES
 * that draft. The field rules ran when the caller's payload arrived, and for a
 * publish that payload is just the status, so the draft's own content reached
 * the row having been judged only when it was saved. The publisher may not be
 * the author, and a rule can deny them a value the author was allowed to write.
 *
 * Stripping the denied value, which is the right answer on an ordinary write
 * where the value is the caller's own input, is the wrong answer here: it
 * publishes everything else, consumes the pending change, and destroys the
 * author's edit while reporting success. The publish is refused instead and the
 * draft is kept.
 *
 * The same suite pins the authority the rules are judged with, because a rule
 * that reads `permissions` is answering about the caller: an API key carries
 * its own stamped grants and must not be judged on the database roles of
 * whoever owns it.
 *
 * @module domains/collections/__tests__/collection-promote-judges-the-publisher.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkbox,
  date,
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  json,
  number,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  // `heldStill` moves the clock; the next test starts on the real one.
  vi.useRealTimers();
  await current?.destroy();
  current = undefined;
});

const SLUG = "guardedpost";
const BOSS = { id: "boss", email: "boss@x.test", roles: [] };
const CLERK = { id: "clerk", email: "clerk@x.test", roles: [] };

function handlerOf(t: TestNextly): CollectionsHandler {
  return t.getService("collectionsHandler") as CollectionsHandler;
}

/** Published, with drafts on, and two fields only BOSS may write. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [
          text({ name: "body" }),
          text({
            name: "guarded",
            access: { update: ({ req }) => req.user?.email === BOSS.email },
          }),
          // A denied field NESTED in a group. The rules remove it from inside
          // the container, which leaves the container itself in place, so a
          // comparison that looks only at the top level reports nothing.
          group({
            name: "ops",
            fields: [
              text({
                name: "runbook",
                access: { update: ({ req }) => req.user?.email === BOSS.email },
              }),
            ],
          }),
        ],
      }),
    ],
  });
  return current;
}

/** Every pending working draft this entry holds. */
async function pendingDrafts(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown>[]> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    "nextly_versions",
    {}
  );
  return rows.filter(r => String(r.entryId) === id && r.versionNo === null);
}

/**
 * Every value the store holds for one entry, as the database holds it.
 *
 * The entry's own row (its fields, status and timestamps) and every
 * `nextly_versions` row for it (the published snapshots it has had and the
 * pending working draft), read raw, so a refused write that touched any column
 * of any of them, even one no read surface returns, changes the result.
 */
async function storedState(
  t: TestNextly,
  slug: string,
  id: string
): Promise<{
  entry: Record<string, unknown>[];
  versions: Record<string, unknown>[];
}> {
  const entry = (
    await t.adapter.select<Record<string, unknown>>(`dc_${slug}`, {})
  ).filter(r => String(r.id) === id);
  const versions = (
    await t.adapter.select<Record<string, unknown>>("nextly_versions", {})
  )
    .filter(r => String(r.entryId) === id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { entry, versions };
}

/**
 * Reads what the store holds for an entry just before a write that is about
 * to be refused, and returns the check that the refusal changed none of it.
 *
 * POPULATION CONTROL: the state must hold every part the check compares, or
 * an equality between two empty reads would pass for any write: the live row,
 * published; the one pending working draft; and a published snapshot.
 *
 * The clock then moves an hour on, so a refused write that stamps a time
 * stores a different value even where the column keeps whole seconds and the
 * write lands in the same second as the read.
 */
async function heldStill(
  t: TestNextly,
  slug: string,
  id: string
): Promise<() => Promise<void>> {
  const before = await storedState(t, slug, id);
  expect(before.entry).toHaveLength(1);
  expect(before.entry[0]?.status).toBe("published");
  expect(before.versions.filter(v => v.versionNo === null)).toHaveLength(1);
  expect(
    before.versions.some(v => v.versionNo !== null && v.status === "published")
  ).toBe(true);
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60 * 60 * 1000 });
  return async () => {
    expect(await storedState(t, slug, id)).toEqual(before);
  };
}

async function liveDoc(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown>> {
  const doc = (await t.nextly.findByID({
    collection: SLUG as never,
    id,
    overrideAccess: true,
    status: "all",
  } as never)) as Record<string, unknown> | null;
  return doc ?? {};
}

describe.each(getConfiguredTestDialects())(
  "a collection publish re-judges the draft it promotes (%s)",
  dialect => {
    it("refuses a publish that would change a field the PUBLISHER may not write, and keeps the draft", async () => {
      const t = await boot(dialect);
      const h = handlerOf(t);

      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { body: "live", guarded: "live-value", status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;

      // BOSS may write `guarded`, so the held draft carries their edit legitimately.
      const held = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { body: "edited", guarded: "boss-secret" }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);
      // POPULATION CONTROL: the edit really was held. Without this a later
      // "the draft is still here" could equally mean the save never became one.
      expect(JSON.stringify(await pendingDrafts(t, id))).toContain(
        "boss-secret"
      );
      const unchanged = await heldStill(t, SLUG, id);

      // Someone else publishes. The field rule denies THEM that field.
      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published" }
      );

      expect(published.success).toBe(false);
      const issues = (
        published as {
          publicData?: { errors?: Array<{ path: string; code: string }> };
        }
      ).publicData?.errors;
      expect(issues?.map(i => i.path)).toEqual(["guarded"]);
      expect(issues?.[0]?.code).toBe("FORBIDDEN");

      // Nothing was published, and the pending change is still there for someone
      // who can write the field. This is the whole point: a successful publish
      // deletes the draft, so a strip would have taken BOSS's edit with it.
      const live = await liveDoc(t, id);
      expect(live.body).toBe("live");
      expect(live.guarded).toBe("live-value");
      expect(JSON.stringify(await pendingDrafts(t, id))).toContain(
        "boss-secret"
      );
      // Every stored value is as it was: the entry's columns, its status and
      // timestamps, its published snapshots and its pending draft.
      await unchanged();
    });

    it("catches a denied field NESTED inside a group", async () => {
      const t = await boot(dialect);
      const h = handlerOf(t);

      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        {
          body: "live",
          ops: { runbook: "live-runbook" },
          status: "published",
        }
      );
      const id = (created.data as { id?: string }).id as string;

      await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { ops: { runbook: "boss-runbook" } }
      );
      const unchanged = await heldStill(t, SLUG, id);

      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published" }
      );

      expect(published.success).toBe(false);
      const issues = (
        published as {
          publicData?: { errors?: Array<{ path: string; code: string }> };
        }
      ).publicData?.errors;
      // Named at its own depth, so the author can see what to hand over.
      expect(issues?.map(i => i.path)).toEqual(["ops.runbook"]);
      // And nothing of the entry moved, the nested edit's draft included.
      await unchanged();
    });

    it("publishes normally when the draft changes nothing the publisher is denied", async () => {
      const t = await boot(dialect);
      const h = handlerOf(t);

      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { body: "live", guarded: "live-value", status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;

      // `guarded` is in the promoted document, as it is in every one of them,
      // but at the value it already holds. Only a CHANGE is refused.
      await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { body: "edited" }
      );

      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published" }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      const live = await liveDoc(t, id);
      expect(live.body).toBe("edited");
      expect(live.guarded).toBe("live-value");
      expect(await pendingDrafts(t, id)).toHaveLength(0);
    });

    it("does not read an UNCHANGED denied field as an edit, whatever its type", async () => {
      // The pending change is JSON, so a timestamp arrives here as the ISO string
      // it was serialised to while the live row comes back from the driver as a
      // `Date`. Compared as they arrive, a date-bearing field the publisher may
      // not write reads as an edit and refuses a publish that touches nothing.
      // Every type is covered: only the date arrives in two representations, and
      // a suite that checked one type would not show which.
      const onlyBoss = {
        update: ({ req }: { req?: { user?: { email?: string } } }) =>
          req?.user?.email === BOSS.email,
      };
      const slug = "everytype";
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: () => true,
              publish: () => true,
              unpublish: () => true,
            },
            fields: [
              text({ name: "body" }),
              text({ name: "gtext", access: onlyBoss }),
              date({ name: "gdate", access: onlyBoss }),
              number({ name: "gnum", access: onlyBoss }),
              checkbox({ name: "gbool", access: onlyBoss }),
              json({ name: "gjson", access: onlyBoss }),
              group({
                name: "ggroup",
                access: onlyBoss,
                fields: [text({ name: "note" })],
              }),
            ],
          }),
        ],
      });
      const h = handlerOf(current);

      const created = await h.createEntry(
        { collectionName: slug, overrideAccess: true },
        {
          body: "live",
          gtext: "t",
          gdate: "2026-01-02T03:04:05.000Z",
          gnum: 42,
          gbool: true,
          gjson: { a: 1 },
          ggroup: { note: "i" },
          status: "published",
        }
      );
      const id = (created.data as { id?: string }).id as string;

      // CLERK edits ONLY the unrestricted field; every guarded one is untouched.
      await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { body: "edited" }
      );

      const published = await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published" }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      const doc = (await current.nextly.findByID({
        collection: slug as never,
        id,
        overrideAccess: true,
        status: "all",
      } as never)) as Record<string, unknown> | null;
      expect(doc?.body).toBe("edited");
      // Every guarded value is still there. Asserting only `body` would pass
      // just as well if the publish had gone through and cleared all of them,
      // which is the other way this can be wrong.
      expect(doc?.gtext).toBe("t");
      expect(doc?.gnum).toBe(42);
      expect(doc?.gbool).toBe(true);
      expect(doc?.gjson).toEqual({ a: 1 });
      expect(doc?.ggroup).toEqual({ note: "i" });
      expect(new Date(doc?.gdate as string).toISOString()).toBe(
        "2026-01-02T03:04:05.000Z"
      );
    });

    it("keeps an UNCHANGED denied child when its group is written", async () => {
      // The rules delete a denied value, and the group is one JSON column: hand
      // the write what the rules returned and the partial group is serialised
      // over the whole column, clearing a protected value nobody touched. The
      // document the write gets holds the denied child at its LIVE value.
      const t = await boot(dialect);
      const h = handlerOf(t);

      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        {
          body: "live",
          ops: { runbook: "live-runbook" },
          status: "published",
        }
      );
      const id = (created.data as { id?: string }).id as string;

      // CLERK, who may not write `ops.runbook`, edits only the unrestricted field.
      await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { body: "edited" }
      );

      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published" }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      const live = await liveDoc(t, id);
      expect(live.body).toBe("edited");
      // The protected value is still here. Nobody asked for it to go.
      expect(live.ops).toEqual({ runbook: "live-runbook" });
    });

    it("refuses a pending change that CLEARS a field it may not write", async () => {
      // A GUARD, not a demonstration. Clearing a field sends `null`, which is a
      // present key and so is judged like any other value. The case the live-side
      // pass exists for is a key ABSENT from the promoted document entirely, which
      // no known route through the public API produces, since a collection
      // snapshot is a full copy of the row, so that half is guarded defensively.
      const t = await boot(dialect);
      const h = handlerOf(t);

      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { body: "live", guarded: "live-value", status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;

      // BOSS may write it, so clearing it is a legitimate pending change.
      await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { body: "edited", guarded: null }
      );
      const unchanged = await heldStill(t, SLUG, id);

      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published" }
      );

      expect(published.success).toBe(false);
      const issues = (
        published as { publicData?: { errors?: Array<{ path: string }> } }
      ).publicData?.errors;
      expect(issues?.map(i => i.path)).toEqual(["guarded"]);
      // The value is untouched, and the deletion is still pending for someone
      // who may make it.
      const live = await liveDoc(t, id);
      expect(live.guarded).toBe("live-value");
      expect(await pendingDrafts(t, id)).toHaveLength(1);
      await unchanged();
    });

    it("publishes a date the CALLER supplies alongside the status", async () => {
      // The shaping pass coerces a caller's date to a `Date` before the resolver
      // sees it, and a `Date` is an object with no enumerable keys: a rebuild
      // that treats every object as a container returns `{}` and the driver then
      // refuses that write with "value.getTime is not a function", so nothing
      // goes live.
      const slug = "dated";
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: () => true,
              publish: () => true,
              unpublish: () => true,
            },
            fields: [
              text({ name: "body" }),
              date({ name: "goesLive" }),
              // One denied field, so the resolver runs at all.
              text({
                name: "guarded",
                access: { update: ({ req }) => req.user?.email === BOSS.email },
              }),
            ],
          }),
        ],
      });
      const h = handlerOf(current);

      const created = await h.createEntry(
        { collectionName: slug, overrideAccess: true },
        {
          body: "live",
          goesLive: "2026-01-02T03:04:05.000Z",
          guarded: "live-value",
          status: "published",
        }
      );
      const id = (created.data as { id?: string }).id as string;

      await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { body: "edited" }
      );

      const published = await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published", goesLive: "2026-09-09T09:09:09.000Z" }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      const doc = (await current.nextly.findByID({
        collection: slug as never,
        id,
        overrideAccess: true,
        status: "all",
      } as never)) as Record<string, unknown> | null;
      expect(new Date(doc?.goesLive as string).toISOString()).toBe(
        "2026-09-09T09:09:09.000Z"
      );
      expect(doc?.guarded).toBe("live-value");
    });

    it("publishes a group edit sent with the status while a change is pending", async () => {
      // No field rules at all, so nothing here is about access. The ordinary
      // write encodes a group to its column string before the promotion runs, so
      // the promoted document has to be validated in its logical shape: read as
      // the column string, any group, repeater or JSON field is refused as "ops
      // must be an object", and publishing alongside an edit to one is the
      // ordinary shape of an editor publishing their work.
      const slug = "grouppublish";
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: () => true,
              publish: () => true,
              unpublish: () => true,
            },
            fields: [
              text({ name: "body" }),
              group({ name: "ops", fields: [text({ name: "note" })] }),
            ],
          }),
        ],
      });
      const h = handlerOf(current);

      const created = await h.createEntry(
        { collectionName: slug, overrideAccess: true },
        { body: "live", ops: { note: "live-note" }, status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;

      await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { body: "edited" }
      );

      const published = await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published", ops: { note: "published-note" } }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      const doc = (await current.nextly.findByID({
        collection: slug as never,
        id,
        overrideAccess: true,
        status: "all",
      } as never)) as Record<string, unknown> | null;
      expect(doc?.body).toBe("edited");
      expect(doc?.ops).toEqual({ note: "published-note" });
    });

    it("keeps an edit the publisher may make when its rule reads a field group sent with it", async () => {
      // `gated` may change only while `cfg` is open, and the publisher opens
      // it in the same publish. The field group is written apart from the
      // entry's own fields, so a judgment of the publisher's values without it
      // would refuse `gated` and put the pending change's value in its place.
      const slug = "siblingpublish";
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({ slug: "pmode", fields: [text({ name: "mode" })] }),
        ],
        collections: [
          defineCollection({
            slug,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: () => true,
              publish: () => true,
              unpublish: () => true,
            },
            fields: [
              text({ name: "body" }),
              fieldGroup({ name: "cfg", component: "pmode" }),
              text({
                name: "gated",
                access: {
                  update: ({ data }) =>
                    (data?.cfg as { mode?: unknown } | undefined)?.mode ===
                    "open",
                },
              }),
            ],
          }),
        ],
      } as never);
      const h = handlerOf(current);

      const created = await h.createEntry(
        { collectionName: slug, overrideAccess: true },
        {
          body: "live",
          cfg: { mode: "closed" },
          gated: "live-gated",
          status: "published",
        }
      );
      const id = (created.data as { id?: string }).id as string;
      await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { body: "edited" }
      );

      const published = await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published", cfg: { mode: "open" }, gated: "clerk-gated" }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      const doc = (await current.nextly.findByID({
        collection: slug as never,
        id,
        overrideAccess: true,
        status: "all",
      } as never)) as Record<string, unknown> | null;
      expect(doc?.body).toBe("edited");
      expect(doc?.gated).toBe("clerk-gated");
    });

    it("publishes, keeping a protected child at its stored value, when a group the caller sends carries it", async () => {
      // A group the caller sends replaces the pending change's group whole. The
      // field gate keeps a child the caller may not write at the value the row
      // holds rather than stripping it, so the promoted group still has it and
      // nothing reads as a deletion: the publish goes through with the caller's
      // allowed edit, and the protected child is unchanged. It was refused while
      // the gate stripped such a child. The case after this one keeps the
      // dangerous direction refused: a publisher echoing a protected path the
      // pending change edited.
      const slug = "provenance";
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: () => true,
              publish: () => true,
              unpublish: () => true,
            },
            fields: [
              text({ name: "body" }),
              group({
                name: "ops",
                fields: [
                  text({ name: "note" }),
                  text({
                    name: "runbook",
                    access: {
                      update: ({ req }) => req.user?.email === BOSS.email,
                    },
                  }),
                ],
              }),
            ],
          }),
        ],
      });
      const h = handlerOf(current);

      const created = await h.createEntry(
        { collectionName: slug, overrideAccess: true },
        {
          body: "live",
          ops: { note: "live-note", runbook: "live-runbook" },
          status: "published",
        }
      );
      const id = (created.data as { id?: string }).id as string;

      // A pending change exists, so the publish below promotes one.
      await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { body: "edited" }
      );

      // CLERK sends the whole group: an allowed edit to `note`, and `runbook` at
      // the value it already holds, which the gate will strip from their payload.
      const published = await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        {
          status: "published",
          ops: { note: "clerk-note", runbook: "live-runbook" },
        }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      // The pending change and the caller's allowed edit are live, and the
      // protected child keeps the value it had; the pending change is consumed.
      const doc = (await current.nextly.findByID({
        collection: slug as never,
        id,
        overrideAccess: true,
        status: "all",
      } as never)) as Record<string, unknown> | null;
      expect(doc?.body).toBe("edited");
      expect(doc?.ops).toEqual({ note: "clerk-note", runbook: "live-runbook" });
      expect(await pendingDrafts(current, id)).toHaveLength(0);
    });

    it("refuses, and keeps the draft, when a group the caller sends echoes a protected child the pending change edited", async () => {
      // The nested form of the case below. The pending change, by someone who
      // may write the protected child, edits it; the publisher sends the whole
      // group with the child at its live value. Kept at the stored value, the
      // child would read as the publisher's own input, and a successful
      // publish would consume the draft and lose the author's edit.
      const slug = "provenance_nested";
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug,
            status: true,
            versions: { drafts: true },
            access: {
              read: () => true,
              update: () => true,
              publish: () => true,
              unpublish: () => true,
            },
            fields: [
              text({ name: "body" }),
              group({
                name: "ops",
                fields: [
                  text({ name: "note" }),
                  text({
                    name: "runbook",
                    access: {
                      update: ({ req }) => req.user?.email === BOSS.email,
                    },
                  }),
                ],
              }),
            ],
          }),
        ],
      });
      const h = handlerOf(current);

      const created = await h.createEntry(
        { collectionName: slug, overrideAccess: true },
        {
          body: "live",
          ops: { note: "live-note", runbook: "live-runbook" },
          status: "published",
        }
      );
      const id = (created.data as { id?: string }).id as string;

      // BOSS's pending change edits the protected child.
      await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { ops: { note: "live-note", runbook: "boss-runbook" } }
      );
      expect(await pendingDrafts(current, id)).toHaveLength(1);

      // CLERK publishes the whole group, the child at its live value.
      const published = await h.updateEntry(
        {
          collectionName: slug,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        {
          status: "published",
          ops: { note: "clerk-note", runbook: "live-runbook" },
        }
      );

      expect(published.success, JSON.stringify(published)).toBe(false);
      // Nothing published, and BOSS's pending change is still there.
      const doc = (await current.nextly.findByID({
        collection: slug as never,
        id,
        overrideAccess: true,
        status: "all",
      } as never)) as Record<string, unknown> | null;
      expect(doc?.ops).toEqual({ note: "live-note", runbook: "live-runbook" });
      expect(await pendingDrafts(current, id)).toHaveLength(1);
    });

    it("refuses, and keeps the draft, when the publisher echoes a protected path the pending change edited", async () => {
      // A full form resubmits every field, so a publisher routinely sends a
      // protected value back unchanged. The field gate strips it, which leaves the
      // pending change's edit in the promoted document. Credited to the publisher
      // because the path appears in their request, that edit would be restored to
      // live while the successful publish deletes the draft, so the author's edit
      // would be gone with success reported.
      const t = await boot(dialect);
      const h = handlerOf(t);

      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { body: "live", guarded: "live-value", status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;

      await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { guarded: "boss-secret" }
      );
      expect(JSON.stringify(await pendingDrafts(t, id))).toContain(
        "boss-secret"
      );
      const unchanged = await heldStill(t, SLUG, id);

      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: CLERK,
        },
        { status: "published", guarded: "live-value" }
      );

      expect(published.success).toBe(false);
      const issues = (
        published as {
          publicData?: { errors?: Array<{ path: string; code: string }> };
        }
      ).publicData?.errors;
      expect(issues?.map(i => i.path)).toEqual(["guarded"]);
      expect(issues?.[0]?.code).toBe("FORBIDDEN");
      const live = await liveDoc(t, id);
      expect(live.guarded).toBe("live-value");
      expect(JSON.stringify(await pendingDrafts(t, id))).toContain(
        "boss-secret"
      );
      await unchanged();
    });

    it("still promotes the change for a publisher who MAY write it", async () => {
      const t = await boot(dialect);
      const h = handlerOf(t);

      const created = await h.createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { body: "live", guarded: "live-value", status: "published" }
      );
      const id = (created.data as { id?: string }).id as string;

      await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { body: "edited", guarded: "boss-secret" }
      );

      const published = await h.updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { status: "published" }
      );

      expect(published.success, JSON.stringify(published)).toBe(true);
      const live = await liveDoc(t, id);
      expect(live.guarded).toBe("boss-secret");
      expect(await pendingDrafts(t, id)).toHaveLength(0);
    });
  }
);

describe("a collection field rule is judged on the CALLER's own authority", () => {
  it("gives an API key the permissions stamped on the key", async () => {
    const slug = "keyscoped";
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug,
          access: { read: () => true, update: () => true, create: () => true },
          fields: [
            text({ name: "body" }),
            text({
              name: "secret",
              access: {
                update: ({ permissions }) =>
                  (permissions as string[]).includes("write-secret"),
              },
            }),
          ],
        }),
      ],
    });
    const h = handlerOf(current);

    const created = await h.createEntry(
      { collectionName: slug, overrideAccess: true },
      { body: "b", secret: "before" }
    );
    const id = (created.data as { id?: string }).id as string;

    const updated = await h.updateEntry(
      {
        collectionName: slug,
        entryId: id,
        routeAuthorized: true,
        user: { id: "key-owner" },
        authenticatedScope: {
          actorType: "apiKey",
          permissions: [`update-${slug}`, "write-secret"],
        },
      } as never,
      { body: "b2", secret: "after" }
    );

    expect(updated.success, JSON.stringify(updated)).toBe(true);
    const doc = (await current.nextly.findByID({
      collection: slug as never,
      id,
      overrideAccess: true,
    } as never)) as Record<string, unknown> | null;
    expect(doc?.body).toBe("b2");
    // The key holds the grant the rule asks for. Judged on the key owner's
    // database roles instead, the rule sees no permissions at all and the write
    // is stripped in silence: a correctly scoped key cannot write its own field
    // and the call still reports success.
    expect(doc?.secret).toBe("after");
  });
});
