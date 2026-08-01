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
    slug: "posts",
    status: true,
    fields: [text({ name: "title" })],
  });

// `getService` is keyed by service NAME — `ServiceMap` already maps "collectionsHandler" to its
// type, so passing the type as the generic makes it `unknown` instead of narrowing it.
function handler(t: TestNextly) {
  return t.getService("collectionsHandler");
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
  const rows = await tableRows(t, "dc_posts");
  return rows.find(r => r.id === id) ?? {};
}

describe("first_published_at", () => {
  it("stays null while a document has only ever been a draft", async () => {
    // The column has to distinguish "never public" from "public once", so a draft must not carry
    // a value simply because the row exists.
    current = await createTestNextly({ collections: [posts()] });

    const created = await handler(current).createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    expect((await storedRow(current, id)).first_published_at).toBeFalsy();
  });

  it("is stamped when a draft is published", async () => {
    current = await createTestNextly({ collections: [posts()] });
    const h = handler(current);

    const created = await h.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "wip", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    expect((await storedRow(current, id)).first_published_at).toBeFalsy();

    await h.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { status: "published" }
    );

    expect((await storedRow(current, id)).first_published_at).toBeTruthy();
  });

  it("is stamped when a document is created directly as published", async () => {
    // A create has no prior status, so landing on published IS the first publication. Without
    // this the whole create-and-publish path would leave the marker null forever.
    current = await createTestNextly({ collections: [posts()] });

    const created = await handler(current).createEntry(
      { collectionName: "posts", overrideAccess: true },
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
      { collectionName: "posts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    const stamped = (await storedRow(current, id)).first_published_at;
    expect(stamped).toBeTruthy();

    await h.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
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
      { collectionName: "posts", overrideAccess: true },
      { title: "live", status: "published" }
    );
    const id = (created.data as { id: string }).id;

    // Backdated so a re-stamp would be VISIBLE. Both publications otherwise land inside the same
    // second, and these columns store no finer resolution than that on every dialect — so the
    // assertion would hold whether or not the set-once guard exists, and pass for the wrong
    // reason. Confirmed: without the backdate, removing the guard leaves this test green.
    const backdated = new Date("2020-01-01T00:00:00.000Z");
    await current.adapter.update(
      "dc_posts",
      { first_published_at: backdated },
      { and: [{ column: "id", op: "=", value: id }] }
    );
    const before = (await storedRow(current, id)).first_published_at;
    expect(before).toBeTruthy();

    await h.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
      { status: "draft" }
    );
    await h.updateEntry(
      { collectionName: "posts", entryId: id, overrideAccess: true },
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
        defineCollection({ slug: "notes", fields: [text({ name: "title" })] }),
      ],
    });

    const created = await handler(current).createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "n" }
    );
    const id = (created.data as { id: string }).id;
    const rows = await tableRows(current, "dc_notes");
    const row = rows.find(r => r.id === id) ?? {};

    expect(Object.keys(row)).not.toContain("first_published_at");
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
          slug: "banner",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles = current.getService("singleEntryService");

    await singles.update(
      "banner",
      { title: "hi", status: "draft" },
      { overrideAccess: true }
    );
    expect(
      (await tableRows(current, "single_banner"))[0]?.first_published_at
    ).toBeFalsy();

    await singles.update(
      "banner",
      { title: "hi", status: "published" },
      { overrideAccess: true }
    );

    const row = (await tableRows(current, "single_banner"))[0] ?? {};
    expect(row.status).toBe("published");
    expect(row.first_published_at).toBeTruthy();
    // The read path is the thing the missing column broke, so exercise it rather than only
    // inspecting the table.
    const read = await singles.get("banner", { overrideAccess: true });
    expect(read).toBeTruthy();
  });

  it("keeps a Single's marker across an unpublish and a republish", async () => {
    // Same set-once guarantee collections get. Backdated first, because both publications
    // otherwise land inside the same second and these columns store no finer resolution — the
    // assertion would then hold whether or not the guard exists.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "banner",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singles = current.getService("singleEntryService");

    await singles.update(
      "banner",
      { title: "hi", status: "published" },
      { overrideAccess: true }
    );
    const singleId = (await tableRows(current, "single_banner"))[0]?.id;
    // Narrowed rather than asserted: the row is read back as `Record<string, unknown>`, and a
    // missing id would otherwise reach the adapter as an undefined bind parameter and update
    // every row, which is not the thing this test means to set up.
    if (typeof singleId !== "string") {
      throw new Error("single_banner row has no id");
    }
    await current.adapter.update(
      "single_banner",
      { first_published_at: new Date("2020-01-01T00:00:00.000Z") },
      { and: [{ column: "id", op: "=", value: singleId }] }
    );
    const before = (await tableRows(current, "single_banner"))[0]
      ?.first_published_at;
    expect(before).toBeTruthy();

    await singles.update(
      "banner",
      { status: "draft" },
      { overrideAccess: true }
    );
    const unpublished = (await tableRows(current, "single_banner"))[0] ?? {};
    expect(unpublished.status).toBe("draft");
    expect(unpublished.first_published_at).toBeTruthy();

    await singles.update(
      "banner",
      { status: "published" },
      { overrideAccess: true }
    );
    expect(
      String((await tableRows(current, "single_banner"))[0]?.first_published_at)
    ).toBe(String(before));
  });
});
