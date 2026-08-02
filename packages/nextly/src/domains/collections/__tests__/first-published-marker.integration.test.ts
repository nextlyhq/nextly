/**
 * The durable record that a document has been public.
 *
 * `status` describes what a document IS. Unpublishing returns it to `draft` and, before this
 * column, erased every trace it had ever been live — while the inbound links, feeds and search
 * results it accumulated stayed exactly where they were. Anything that has to ask "was this
 * address ever public" (slug stability, redirect capture) needs an answer that survives that round
 * trip, so these run against a real database rather than asserting on statement text: what matters
 * is the value that is still there after the unpublish committed.
 */
import assert from "node:assert/strict";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const posts = () =>
  defineCollection({
    slug: "fpmposts",
    status: true,
    fields: [text({ name: "title" })],
  });

// `getService` is keyed by service NAME — `ServiceMap` already maps "collectionsHandler" to its
// type, so passing the type as the generic makes it `unknown` instead of narrowing it.
function handler(t: TestNextly) {
  return t.getService("collectionsHandler");
}

/** The transaction-scoped writer behind createMany and batch writes. Reached through the handler
 *  because the service-level wrapper does not forward `overrideAccess`. */
function txEntries(t: TestNextly) {
  return t.getService("collectionsHandler").getEntryService();
}

/** Narrow an unknown payload branch before indexing it, so a shape change surfaces as a failed
 *  assertion rather than an `undefined` that quietly satisfies the test. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Rows read straight from the physical table, so the assertion sees the column itself rather
 *  than whatever the read shape chooses to project. */
async function tableRows(
  t: TestNextly,
  table: string
): Promise<Record<string, unknown>[]> {
  return t.adapter.select<Record<string, unknown>>(table);
}

async function storedRow(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown>> {
  const rows = await tableRows(t, "dc_fpmposts");
  return rows.find(r => r.id === id) ?? {};
}

describe("first_published_at", () => {
  it("stays null while a document has only ever been a draft", async () => {
    // The column has to distinguish "never public" from "public once", so a draft must not carry
    // a value simply because the row exists.
    current = await createTestNextly({ collections: [posts()] });

    const created = await handler(current).createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    expect((await storedRow(current, id)).first_published_at).toBeFalsy();
  });

  it("is stamped when a draft is published", async () => {
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    expect((await storedRow(current, id)).first_published_at).toBeFalsy();

    await h.updateEntry(
      { collectionName: "fpmposts", entryId: id, overrideAccess: true },
      { status: "published" }
    );

    expect((await storedRow(current, id)).first_published_at).toBeTruthy();
  });

  it("is stamped when a document is created directly as published", async () => {
    // A create has no prior status, so landing on published IS the first publication. Without
    // this the whole create-and-publish path would leave the marker null forever.
    current = await createTestNextly({ collections: [posts()] });

    const created = await handler(current).createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    expect((await storedRow(current, id)).first_published_at).toBeTruthy();
  });

  it("survives an unpublish", async () => {
    // The case the column exists for. `status` goes back to draft; the record that this address
    // was once public must not go with it.
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    const stamped = (await storedRow(current, id)).first_published_at;
    expect(stamped).toBeTruthy();

    await h.updateEntry(
      { collectionName: "fpmposts", entryId: id, overrideAccess: true },
      { status: "draft" }
    );

    const after = await storedRow(current, id);
    expect(after.status).toBe("draft");
    expect(after.first_published_at).toBeTruthy();
  });

  it("does not move when the document is published again", async () => {
    // It dates the FIRST publication. A republish that reset it would report the most recent go
    // live, which is a different question and would make the marker useless for the first.
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Backdated so a re-stamp would be VISIBLE. Both publications otherwise land inside the same
    // second, and these columns store no finer resolution than that on every dialect — so the
    // assertion would hold whether or not the set-once guard exists, and pass for the wrong
    // reason. Confirmed: without the backdate, removing the guard leaves this test green.
    const backdated = new Date("2020-01-01T00:00:00.000Z");
    await current.adapter.update(
      "dc_fpmposts",
      { first_published_at: backdated },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    const before = (await storedRow(current, id)).first_published_at;
    expect(before).toBeTruthy();

    await h.updateEntry(
      { collectionName: "fpmposts", entryId: id, overrideAccess: true },
      { status: "draft" }
    );
    await h.updateEntry(
      { collectionName: "fpmposts", entryId: id, overrideAccess: true },
      { status: "published" }
    );

    expect(String((await storedRow(current, id)).first_published_at)).toBe(
      String(before)
    );
  });

  it("is not added to a collection with no draft lifecycle", async () => {
    // Such a collection publishes on save and has no transition to record, so the column would be
    // a migration every user pays for and nothing ever writes.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "fpmnotes",
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const created = await handler(current).createEntry(
      { collectionName: "fpmnotes", overrideAccess: true },
      { title: "n" }
    );
    const id = (created.data as { id: string }).id;
    const rows = await tableRows(current, "dc_fpmnotes");
    const row = rows.find(r => r.id === id) ?? {};

    expect(Object.keys(row)).not.toContain("first_published_at");
  });

  it("ignores a marker supplied by the client on create", async () => {
    // The column is not a declared field, so field validation passes it straight through: without
    // stripping, a draft create can invent a publication date for a document that has never been
    // public. Both spellings, because the snake-case pass would otherwise let the camelCase alias
    // through and land on the same column.
    current = await createTestNextly({ collections: [posts()] });

    const created = await handler(current).createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      {
        title: "wip",
        status: "draft",
        firstPublishedAt: new Date("1999-01-01T00:00:00.000Z"),
        first_published_at: new Date("1999-01-01T00:00:00.000Z"),
      }
    );
    const id = (created.data as { id: string }).id;

    expect((await storedRow(current, id)).first_published_at).toBeFalsy();
  });

  it("ignores a marker supplied by the client on update", async () => {
    // The set-once guarantee is only worth as much as the write path's refusal to take a value
    // from the request: an update that could reset it would make the marker report whatever the
    // last caller chose.
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    const stamped = String((await storedRow(current, id)).first_published_at);

    await h.updateEntry(
      { collectionName: "fpmposts", entryId: id, overrideAccess: true },
      {
        title: "edited",
        firstPublishedAt: new Date("1999-01-01T00:00:00.000Z"),
        first_published_at: new Date("1999-01-01T00:00:00.000Z"),
      }
    );

    expect(String((await storedRow(current, id)).first_published_at)).toBe(
      stamped
    );
  });

  it("does not date a first publication when publish-all changes nothing", async () => {
    // The rows this would hit are the ones it would be most wrong about: published before this
    // column existed, so their marker is null precisely because their history was never recorded.
    // Stamping today reports a publication that did not happen, which is what a null exists to
    // avoid claiming. Simulated by clearing the marker on an already-published row, since a
    // genuinely legacy row cannot be created through the API.
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    await current.adapter.update(
      "dc_fpmposts",
      { first_published_at: null },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    expect((await storedRow(current, id)).first_published_at).toBeFalsy();

    await h.publishAllLocales({
      collectionName: "fpmposts",
      entryId: id,
      overrideAccess: true,
    });

    const after = await storedRow(current, id);
    expect(after.status).toBe("published");
    expect(after.first_published_at).toBeFalsy();
  });

  it("dates a first publication when publish-all does move the row", async () => {
    // The other half of the same branch: publish-all on a draft IS a first publication, and
    // gating the stamp on a real transition must not turn it off here.
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    expect((await storedRow(current, id)).first_published_at).toBeFalsy();

    await h.publishAllLocales({
      collectionName: "fpmposts",
      entryId: id,
      overrideAccess: true,
    });

    const after = await storedRow(current, id);
    expect(after.status).toBe("published");
    expect(after.first_published_at).toBeTruthy();
  });

  it("records a first publication through the transaction create API", async () => {
    // `createEntryInTransaction` is a public API and also backs createMany and batch writes. A
    // document created as published through it must carry the same marker the pooled path gives
    // it, or which API a caller happened to use would decide whether the history exists.
    current = await createTestNextly({ collections: [posts()] });
    const entries = txEntries(current);

    const res = await current.adapter.transaction(tx =>
      entries.createEntryInTransaction(
        tx as never,
        { collectionName: "fpmposts", overrideAccess: true },
        { title: "live", status: "published" }
      )
    );
    const id = (res.data as { id: string }).id;

    expect((await storedRow(current, id)).first_published_at).toBeTruthy();
  });

  it("records a first publication through the transaction update API", async () => {
    current = await createTestNextly({ collections: [posts()] });
    const entries = txEntries(current);

    const created = await handler(current).createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    expect((await storedRow(current, id)).first_published_at).toBeFalsy();

    await current.adapter.transaction(tx =>
      entries.updateEntryInTransaction(
        tx as never,
        { collectionName: "fpmposts", entryId: id, overrideAccess: true },
        { status: "published" }
      )
    );

    expect((await storedRow(current, id)).first_published_at).toBeTruthy();
  });

  it("does not move the marker on a republish through the transaction API", async () => {
    // The set-once rule has to hold on every write path, not only the pooled one.
    current = await createTestNextly({ collections: [posts()] });
    const entries = txEntries(current);

    const created = await handler(current).createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    await current.adapter.update(
      "dc_fpmposts",
      { first_published_at: new Date("2020-01-01T00:00:00.000Z") },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    const before = String((await storedRow(current, id)).first_published_at);

    await current.adapter.transaction(tx =>
      entries.updateEntryInTransaction(
        tx as never,
        { collectionName: "fpmposts", entryId: id, overrideAccess: true },
        { status: "draft" }
      )
    );
    await current.adapter.transaction(tx =>
      entries.updateEntryInTransaction(
        tx as never,
        { collectionName: "fpmposts", entryId: id, overrideAccess: true },
        { status: "published" }
      )
    );

    expect(String((await storedRow(current, id)).first_published_at)).toBe(
      before
    );
  });

  it("captures the marker in the version the publish records", async () => {
    // The publish builds its event payload, version snapshot and workflow reaction from the
    // PRE-update row with the new status overlaid, because publishing changes nothing else. The
    // marker is the exception: that same update writes it, so without carrying it across, the
    // publication that establishes a first publication records a snapshot saying there was none.
    //
    // Asserted on the version row rather than the emitted event. Both are built from the same
    // overlaid row, but the version is written inside the publish transaction and can be read
    // back, whereas event DELIVERY through the process-wide bus proved order-dependent in this
    // harness — the assertion passed alone and saw nothing once another file booted first.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "fpmversioned",
          status: true,
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmversioned", overrideAccess: true },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    await h.publishAllLocales({
      collectionName: "fpmversioned",
      entryId: id,
      overrideAccess: true,
    });

    const versions = (
      await current.adapter.select<Record<string, unknown>>("nextly_versions")
    ).filter(v => v.entryId === id && v.status === "published");
    expect(versions.length).toBeGreaterThan(0);

    // The VALUE, not the key: the pre-image carries `first_published_at: null`, so the key is in
    // the snapshot either way and an `in` check would pass with the overlay removed.
    const markers = versions.map(v => {
      const raw = v.snapshot;
      const snapshot =
        typeof raw === "string"
          ? (JSON.parse(raw) as Record<string, unknown>)
          : ((raw ?? {}) as Record<string, unknown>);
      return snapshot.first_published_at ?? snapshot.firstPublishedAt;
    });
    expect(markers.some(m => m != null)).toBe(true);
  });

  it("records a first publication made in a non-default locale", async () => {
    // The marker is a property of the DOCUMENT: "has this ever been public in any language". A
    // translation published on its own is reachable at the address the locales share, so it
    // establishes the marker. Leaving it null until some later default-locale action would record
    // a date after the document was already public, which is exactly the question the slug freeze
    // and redirect capture ask it.
    //
    // The non-default-locale write carries its status on the companion, not the main row, so the
    // main row's own status shows no transition at all — reading the wrong one records nothing.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "fpmposts",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
      localization: { locales: ["en", "es"], defaultLocale: "en" },
    });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true, locale: "en" },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    expect((await storedRow(current, id)).first_published_at).toBeFalsy();

    // Publish only the Spanish translation, as a trusted write. The access-controlled variant of
    // this write reads the companion's prior status instead of the main row's; that selection is
    // covered by `resolveFirstPublishedStamp`'s unit tests, because reaching it here would need a
    // user holding a real `publish-posts` grant and the suite has no helper that seeds one.
    await h.updateEntry(
      {
        collectionName: "fpmposts",
        entryId: id,
        locale: "es",
        overrideAccess: true,
      },
      { title: "hola", status: "published" }
    );

    const row = await storedRow(current, id);
    // The main row is still a draft — only the translation went public — and that is the point:
    // status and the marker answer different questions.
    expect(row.status).toBe("draft");
    expect(row.first_published_at).toBeTruthy();
  });

  it("returns the marker under one name whichever operation is called", async () => {
    // The same entry gave different shapes depending on how it was fetched: a create response
    // carried `firstPublishedAt` while list and detail reads returned the raw column name, so a
    // client reading a field it had just written could not find it.
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmposts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    const detail = await h.getEntry({
      collectionName: "fpmposts",
      entryId: id,
      overrideAccess: true,
    });
    const list = await h.listEntries({
      collectionName: "fpmposts",
      overrideAccess: true,
    });

    for (const [label, doc] of [
      ["create", created.data],
      ["detail", detail.data],
      ["list", list.data?.docs?.[0]],
    ] as const) {
      assert(isRecord(doc), `${label} returned no document`);
      expect({ [label]: "firstPublishedAt" in doc }).toEqual({ [label]: true });
      // The raw column name must not also be present, or a consumer sees two spellings of the
      // same value and has to guess which is canonical.
      expect({ [label]: "first_published_at" in doc }).toEqual({
        [label]: false,
      });
    }
  });

  it("keeps the marker on the working-draft shapes of a published document", async () => {
    // A document with a pending working draft is written and read through documents rebuilt from a
    // stored snapshot rather than from the row, and each rebuild restored the system columns from a
    // list written out by hand. The marker was missing from those while an ordinary read of the
    // same document returned it, so a published entry looked like one that had never been public
    // for exactly as long as someone was editing it.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "fpmdrafts",
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const h = handler(current);
    const trusted = { collectionName: "fpmdrafts", overrideAccess: true };

    const created = await h.createEntry(trusted, {
      title: "live",
      status: "published",
    });
    const id = (created.data as { id: string }).id;

    // An update carrying no status accumulates a working draft instead of touching the live row.
    const updated = await h.updateEntry(
      { ...trusted, entryId: id },
      { title: "edited" }
    );
    assert(isRecord(updated.data), "the update returned no document");
    // The live row is untouched, which is what proves the response above came from the draft
    // shaper rather than from an ordinary row update that would carry the column anyway.
    const rows = await tableRows(current, "dc_fpmdrafts");
    expect(rows.find(r => r.id === id)?.title).toBe("live");
    expect(updated.data.title).toBe("edited");
    expect(updated.data.firstPublishedAt).toBeInstanceOf(Date);

    // A second save is the one that exercises the snapshot round trip: the first accumulated its
    // document from the live row, where the timestamp is still database-decoded, while this one
    // rebuilds from the stored draft, where JSON has left it a string.
    const resaved = await h.updateEntry(
      { ...trusted, entryId: id },
      { title: "edited again" }
    );
    assert(isRecord(resaved.data), "the second update returned no document");
    expect(resaved.data.title).toBe("edited again");
    expect(resaved.data.firstPublishedAt).toBeInstanceOf(Date);

    // The read that overlays that draft has to agree with an ordinary read on both counts: that
    // the marker is present, and that it is a Date. A hook calling a date method would otherwise
    // fail only for an entry that happens to be drafted.
    const overlaid = await h.getEntry({
      ...trusted,
      entryId: id,
      includeWorkingDraft: true,
    });
    assert(isRecord(overlaid.data), "the draft read returned no document");
    expect(overlaid.data._isWorkingDraft).toBe(true);
    expect(overlaid.data.title).toBe("edited again");
    expect(overlaid.data.firstPublishedAt).toBeInstanceOf(Date);

    const live = await h.getEntry({ ...trusted, entryId: id });
    assert(isRecord(live.data), "the live read returned no document");
    expect(live.data.firstPublishedAt).toBeInstanceOf(Date);
  });

  it("leaves a legacy already-public document unmarked when a translation publishes", async () => {
    // The row this protects: published before this column existed, so its marker is null because
    // the history was never recorded, not because it was never public. Publishing a translation
    // afterwards must not date its first publication from today — the per-locale transition sees
    // that one locale going live and cannot tell it apart from the document becoming public.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "fpmlegacy",
          status: true,
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
      localization: { locales: ["en", "es"], defaultLocale: "en" },
    });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "fpmlegacy", overrideAccess: true, locale: "en" },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Clear the marker to reproduce an upgraded row: already public, no recorded history.
    await current.adapter.update(
      "dc_fpmlegacy",
      { first_published_at: null },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    const rows =
      await current.adapter.select<Record<string, unknown>>("dc_fpmlegacy");
    const legacy = rows.find(r => r.id === id) ?? {};
    expect(legacy.status).toBe("published");
    expect(legacy.first_published_at).toBeFalsy();

    await h.updateEntry(
      {
        collectionName: "fpmlegacy",
        entryId: id,
        locale: "es",
        overrideAccess: true,
      },
      { title: "hola", status: "published" }
    );

    const after = (
      await current.adapter.select<Record<string, unknown>>("dc_fpmlegacy")
    ).find(r => r.id === id);
    expect(after?.first_published_at).toBeFalsy();
  });

  it("records a first publication through the batch create worker", async () => {
    // The batch service calls its own streamlined worker, not `createEntryInTransaction`, so
    // fixing the transaction API left this path unstamped. Whether a document's history exists
    // must not depend on whether it was written one at a time or in a batch.
    current = await createTestNextly({ collections: [posts()] });
    const entries = txEntries(current);

    const result = await entries.createEntries(
      { collectionName: "fpmposts", overrideAccess: true },
      [
        { title: "live", status: "published" },
        { title: "wip", status: "draft" },
      ]
    );
    expect(result.successful).toBe(2);

    const rows = await tableRows(current, "dc_fpmposts");
    const live = rows.find(r => r.title === "live") ?? {};
    const wip = rows.find(r => r.title === "wip") ?? {};
    expect(live.first_published_at).toBeTruthy();
    expect(wip.first_published_at).toBeFalsy();
  });

  it("does not stamp a batch create that stays a draft", async () => {
    // The negative half of the batch-create case above, in the same worker: a batch that writes
    // drafts records nothing, so the stamp is tied to the transition rather than to the path.
    //
    // The batch UPDATE worker is not covered here. It is reachable only through `updateEntries`,
    // which accepts no `overrideAccess` — so publishing through it always requires a caller
    // holding a real `publish-<slug>` grant, and this suite has no helper that seeds one. Its
    // wiring mirrors the create worker asserted above and calls the same unit-tested rule.
    current = await createTestNextly({ collections: [posts()] });
    const entries = txEntries(current);

    const result = await entries.createEntries(
      { collectionName: "fpmposts", overrideAccess: true },
      [
        { title: "a", status: "draft" },
        { title: "b", status: "draft" },
      ]
    );
    expect(result.successful).toBe(2);

    for (const row of await tableRows(current, "dc_fpmposts")) {
      expect(row.first_published_at).toBeFalsy();
    }
  });

  it("records a Single's first publication, and reads still work", async () => {
    // This test used to assert the OPPOSITE. A Single's physical table was built by a generator
    // that restated the system columns by hand, so this column reached the runtime schema and not
    // the table, and the resulting SELECT named a column that is not there — failing EVERY read of
    // a status-enabled Single rather than merely leaving the marker unset. That generator now
    // renders from the descriptor, so the column arrives on its own. The read assertion is kept
    // because it is what would catch that regression returning.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "fpmbanner",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles = current.getService("singleEntryService");

    await singles.update(
      "fpmbanner",
      { title: "hi", status: "draft" },
      { overrideAccess: true }
    );
    expect(
      (await tableRows(current, "single_fpmbanner"))[0]?.first_published_at
    ).toBeFalsy();

    await singles.update(
      "fpmbanner",
      { title: "hi", status: "published" },
      { overrideAccess: true }
    );

    const row = (await tableRows(current, "single_fpmbanner"))[0] ?? {};
    expect(row.status).toBe("published");
    expect(row.first_published_at).toBeTruthy();
    // The read path is the thing the missing column broke, so exercise it rather than only
    // inspecting the table.
    const read = await singles.get("fpmbanner", { overrideAccess: true });
    expect(read).toBeTruthy();
  });

  it("keeps a Single's own field named created_by", async () => {
    // A single has no owner column — its system columns are id, title, slug, the timestamps,
    // status and the marker — so `created_by` is an ordinary field name a single may declare.
    // Reserving it on singles because collections reserve it would silently discard the user's
    // own column on every update, which is why the reserved set follows the column rather than
    // being shared wholesale.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "fpmowner",
          fields: [text({ name: "title" }), text({ name: "created_by" })],
        }),
      ],
    });
    const singles = current.getService("singleEntryService");

    await singles.update(
      "fpmowner",
      { title: "hi", created_by: "written by the user" },
      { overrideAccess: true }
    );

    const row = (await tableRows(current, "single_fpmowner"))[0] ?? {};
    expect(row.created_by).toBe("written by the user");
  });

  it("ignores a marker supplied by the client on a Single", async () => {
    // A Single's writer had no immutable-field stripping at all, so a supplied value reached the
    // row: a draft update could invent a publication date, and an update to an already-published
    // Single could reset a real one, since the stamp only replaces the value during a first
    // publication. Both spellings, because the write snake-cases its keys before storing.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "fpmbanner",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles = current.getService("singleEntryService");

    await singles.update(
      "fpmbanner",
      {
        title: "hi",
        status: "draft",
        firstPublishedAt: new Date("1999-01-01T00:00:00.000Z"),
        first_published_at: new Date("1999-01-01T00:00:00.000Z"),
      },
      { overrideAccess: true }
    );
    expect(
      (await tableRows(current, "single_fpmbanner"))[0]?.first_published_at
    ).toBeFalsy();

    // And a real marker cannot be overwritten once the Single has been published.
    await singles.update(
      "fpmbanner",
      { status: "published" },
      { overrideAccess: true }
    );
    const stamped = String(
      (await tableRows(current, "single_fpmbanner"))[0]?.first_published_at
    );

    await singles.update(
      "fpmbanner",
      {
        title: "edited",
        firstPublishedAt: new Date("1999-01-01T00:00:00.000Z"),
        first_published_at: new Date("1999-01-01T00:00:00.000Z"),
      },
      { overrideAccess: true }
    );

    expect(
      String(
        (await tableRows(current, "single_fpmbanner"))[0]?.first_published_at
      )
    ).toBe(stamped);
  });

  it("keeps a Single's marker across an unpublish and a republish", async () => {
    // Same set-once guarantee collections get. Backdated first, because both publications
    // otherwise land inside the same second and these columns store no finer resolution — the
    // assertion would then hold whether or not the guard exists.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "fpmbanner",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles = current.getService("singleEntryService");

    await singles.update(
      "fpmbanner",
      { title: "hi", status: "published" },
      { overrideAccess: true }
    );
    const singleId = (await tableRows(current, "single_fpmbanner"))[0]?.id;
    // Narrowed rather than asserted loosely: the row is read back as `Record<string, unknown>`,
    // and a missing id would otherwise reach the adapter as an undefined bind parameter and
    // update every row, which is not the setup this test intends. `node:assert` narrows the type
    // through its `asserts` signature, so the value is usable without a cast and without a bare
    // throw.
    assert(typeof singleId === "string", "single_fpmbanner row has no id");
    await current.adapter.update(
      "single_fpmbanner",
      { first_published_at: new Date("2020-01-01T00:00:00.000Z") },
      { and: [{ column: "id", op: "=", value: singleId }] }
    );
    const before = (await tableRows(current, "single_fpmbanner"))[0]
      ?.first_published_at;
    expect(before).toBeTruthy();

    await singles.update(
      "fpmbanner",
      { status: "draft" },
      { overrideAccess: true }
    );
    const unpublished = (await tableRows(current, "single_fpmbanner"))[0] ?? {};
    expect(unpublished.status).toBe("draft");
    expect(unpublished.first_published_at).toBeTruthy();

    await singles.update(
      "fpmbanner",
      { status: "published" },
      { overrideAccess: true }
    );
    expect(
      String(
        (await tableRows(current, "single_fpmbanner"))[0]?.first_published_at
      )
    ).toBe(String(before));
  });
});
