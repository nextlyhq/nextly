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
import { afterEach, describe, expect, it } from "vitest";

import {
  checkbox,
  date,
  defineCollection,
  group,
  json,
  number,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
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
async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
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

describe("a collection publish re-judges the draft it promotes", () => {
  it("refuses a publish that would change a field the PUBLISHER may not write, and keeps the draft", async () => {
    const t = await boot();
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "live", guarded: "live-value", status: "published" }
    );
    const id = (created.data as { id?: string }).id as string;

    // BOSS may write `guarded`, so the held draft carries their edit legitimately.
    const held = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: BOSS },
      { body: "edited", guarded: "boss-secret" }
    );
    expect(held.success, JSON.stringify(held)).toBe(true);
    // POPULATION CONTROL: the edit really was held. Without this a later
    // "the draft is still here" could equally mean the save never became one.
    expect(JSON.stringify(await pendingDrafts(t, id))).toContain("boss-secret");

    // Someone else publishes. The field rule denies THEM that field.
    const published = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
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
    expect(JSON.stringify(await pendingDrafts(t, id))).toContain("boss-secret");
  });

  it("catches a denied field NESTED inside a group", async () => {
    const t = await boot();
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
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: BOSS },
      { ops: { runbook: "boss-runbook" } }
    );

    const published = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
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
  });

  it("publishes normally when the draft changes nothing the publisher is denied", async () => {
    const t = await boot();
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "live", guarded: "live-value", status: "published" }
    );
    const id = (created.data as { id?: string }).id as string;

    // `guarded` is in the promoted document, as it is in every one of them,
    // but at the value it already holds. Only a CHANGE is refused.
    await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
      { body: "edited" }
    );

    const published = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
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
    // Every type is covered rather than the one that broke: measured, text,
    // number, boolean, JSON and group agreed and only the date did not, and a
    // suite that checked one of them would not have said so.
    const onlyBoss = {
      update: ({ req }: { req?: { user?: { email?: string } } }) =>
        req?.user?.email === BOSS.email,
    };
    const slug = "everytype";
    current = await createTestNextly({
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
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
      { body: "edited" }
    );

    const published = await h.updateEntry(
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
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
  });

  it("keeps an UNCHANGED denied child when its group is written", async () => {
    // The rules delete a denied value, and the group is one JSON column: hand
    // the write what the rules returned and the partial group is serialised
    // over the whole column, clearing a protected value nobody touched. The
    // document the write gets holds the denied child at its LIVE value.
    const t = await boot();
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
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
      { body: "edited" }
    );

    const published = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
      { status: "published" }
    );

    expect(published.success, JSON.stringify(published)).toBe(true);
    const live = await liveDoc(t, id);
    expect(live.body).toBe("edited");
    // The protected value is still here. Nobody asked for it to go.
    expect(live.ops).toEqual({ runbook: "live-runbook" });
  });

  it("refuses a pending change that CLEARS a field it may not write", async () => {
    // A GUARD, not a demonstration: this passes against the previous revision
    // too. Clearing a field sends `null`, which is a present key and so is
    // judged like any other value. The case the live-side pass exists for is a
    // key ABSENT from the promoted document entirely, which no route through
    // the public API was found to produce, since a collection snapshot is a
    // full copy of the row. That half stays defensive.
    const t = await boot();
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "live", guarded: "live-value", status: "published" }
    );
    const id = (created.data as { id?: string }).id as string;

    // BOSS may write it, so clearing it is a legitimate pending change.
    await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: BOSS },
      { body: "edited", guarded: null }
    );

    const published = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
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
  });

  it("publishes a date the CALLER supplies alongside the status", async () => {
    // The shaping pass coerces a caller's date to a `Date` before the resolver
    // sees it, and a `Date` is an object with no enumerable keys: a rebuild
    // that treats every object as a container returns `{}` and the driver then
    // refuses the write outright. Measured before the fix: the publish failed
    // with "value.getTime is not a function" and nothing went live.
    const slug = "dated";
    current = await createTestNextly({
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
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
      { body: "edited" }
    );

    const published = await h.updateEntry(
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
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
    // write encodes a group to its column string before the promotion runs, and
    // the check that validates the promoted document read that string where it
    // expects an object: a publish that also edited any group, repeater or JSON
    // field was refused as "ops must be an object" whenever a pending change
    // existed, which is the ordinary shape of an editor publishing their edit.
    const slug = "grouppublish";
    current = await createTestNextly({
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
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
      { body: "edited" }
    );

    const published = await h.updateEntry(
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
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

  it("refuses, and keeps the draft, when a group the caller sends drops a protected child", async () => {
    // A KNOWN over-refusal, pinned so it cannot change unnoticed. A group the
    // caller sends replaces the pending change's group whole, and the field gate
    // has already stripped the protected child the caller included, so the
    // promoted group lacks it and it reads as a deletion. Crediting the caller
    // from their raw request would allow it, but that same reading lost a
    // pending edit outright when a caller echoed a protected path, so this
    // refuses instead. It fails closed: the publish is refused and the pending
    // change is kept. Judging each leaf by the source that won the merge is what
    // would allow it.
    const slug = "provenance";
    current = await createTestNextly({
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
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
      { body: "edited" }
    );

    // CLERK sends the whole group: an allowed edit to `note`, and `runbook` at
    // the value it already holds, which the gate will strip from their payload.
    const published = await h.updateEntry(
      { collectionName: slug, entryId: id, routeAuthorized: true, user: CLERK },
      {
        status: "published",
        ops: { note: "clerk-note", runbook: "live-runbook" },
      }
    );

    expect(published.success).toBe(false);
    const issues = (
      published as {
        publicData?: { errors?: Array<{ path: string; code: string }> };
      }
    ).publicData?.errors;
    expect(issues?.map(i => i.path)).toEqual(["ops.runbook"]);
    expect(issues?.[0]?.code).toBe("FORBIDDEN");
    // Nothing published, and the pending change is still there.
    const doc = (await current.nextly.findByID({
      collection: slug as never,
      id,
      overrideAccess: true,
      status: "all",
    } as never)) as Record<string, unknown> | null;
    expect(doc?.body).toBe("live");
    expect(doc?.ops).toEqual({ note: "live-note", runbook: "live-runbook" });
    expect(await pendingDrafts(current, id)).toHaveLength(1);
  });

  it("refuses, and keeps the draft, when the publisher echoes a protected path the pending change edited", async () => {
    // A full form resubmits every field, so a publisher routinely sends a
    // protected value back unchanged. The field gate strips it, which leaves the
    // pending change's edit in the promoted document. Credited to the publisher
    // because the path appeared in their request, that edit was restored to live
    // and the successful publish deleted the draft: measured before this was
    // fixed, success with no pending change left and the author's edit gone.
    const t = await boot();
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "live", guarded: "live-value", status: "published" }
    );
    const id = (created.data as { id?: string }).id as string;

    await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: BOSS },
      { guarded: "boss-secret" }
    );
    expect(JSON.stringify(await pendingDrafts(t, id))).toContain("boss-secret");

    const published = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: CLERK },
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
    expect(JSON.stringify(await pendingDrafts(t, id))).toContain("boss-secret");
  });

  it("still promotes the change for a publisher who MAY write it", async () => {
    const t = await boot();
    const h = handlerOf(t);

    const created = await h.createEntry(
      { collectionName: SLUG, overrideAccess: true },
      { body: "live", guarded: "live-value", status: "published" }
    );
    const id = (created.data as { id?: string }).id as string;

    await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: BOSS },
      { body: "edited", guarded: "boss-secret" }
    );

    const published = await h.updateEntry(
      { collectionName: SLUG, entryId: id, routeAuthorized: true, user: BOSS },
      { status: "published" }
    );

    expect(published.success, JSON.stringify(published)).toBe(true);
    const live = await liveDoc(t, id);
    expect(live.guarded).toBe("boss-secret");
    expect(await pendingDrafts(t, id)).toHaveLength(0);
  });
});

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
