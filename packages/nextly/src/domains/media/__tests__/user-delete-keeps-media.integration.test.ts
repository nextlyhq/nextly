/**
 * Deleting a user must not destroy the files they uploaded.
 *
 * `media.uploaded_by` declares ON DELETE CASCADE, and that rule is still in the
 * schema — this is NOT a test that the database keeps the rows. It covers the
 * application detach: `UserMutationService.deleteUser` sets `uploaded_by` to
 * null inside its own transaction, so by the time the user row goes the cascade
 * has nothing left to act on.
 *
 * That boundary is the point. Every deletion path today goes through
 * `deleteUser`, so every path is covered; a future one that removes a user row
 * without it — a raw statement, a cascade arriving from somewhere else — would
 * still destroy the files, and nothing here would notice. Moving the guarantee
 * beneath the application layer needs the constraint changed, which is blocked
 * on the schema pipeline being able to carry a foreign-key change on
 * PostgreSQL.
 *
 * Run against every dialect the process is configured for, because the detach
 * is a transactional write and transactions are where the three dialects differ
 * most. A run with no server URL set covers SQLite only.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** When the fixture rows claim to have been written. Deliberately long past. */
const STORED_AT = new Date("2020-01-01T00:00:00Z");

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A media row written straight to the table, never through the upload path.
 *
 * An upload would run the local-storage adapter, which writes a real file into
 * `packages/nextly/public/uploads/` and adds a `.gitignore` beside it — neither
 * of which `destroy()` removes, so every run would leave the checkout dirtier
 * than it found it. Nothing here is about uploading; the row is the fixture.
 */
async function insertMediaOwnedBy(
  handle: TestNextly,
  uploaderId: string,
  id: string
): Promise<void> {
  await handle.adapter.insert("media", {
    id,
    filename: `${id}.pdf`,
    originalFilename: `${id}.pdf`,
    mimeType: "application/pdf",
    size: 1,
    url: `/uploads/${id}.pdf`,
    uploadedBy: uploaderId,
    uploadedAt: STORED_AT,
    // A fixed date in the past, so "the detach refreshed this" is a claim a
    // stalled timestamp fails. Stamping it with `new Date()` would leave the
    // before and after equal when nothing updates it, which any
    // greater-than-or-equal assertion accepts — a test that cannot fail.
    updatedAt: STORED_AT,
  });
}

/**
 * The stored row, straight from the table — not through a service.
 *
 * The adapter maps columns back to their FIELD names, so this reads
 * `uploadedBy` rather than the `uploaded_by` the column is called. Reading the
 * column name yields `undefined`, which is indistinguishable from a row that
 * never recorded an uploader — and would fail the control below while the
 * fixture was perfectly correct. It did, before this was fixed.
 */
async function readMediaRow(
  handle: TestNextly,
  mediaId: string
): Promise<{ id: string; uploadedBy: string | null } | undefined> {
  const rows = (await handle.adapter.select("media", {
    where: { and: [{ column: "id", op: "=", value: mediaId }] },
  })) as Array<{ id: string; uploadedBy?: string | null }>;
  const row = rows[0];
  return row ? { id: row.id, uploadedBy: row.uploadedBy ?? null } : undefined;
}

describe.each(getConfiguredTestDialects())(
  "deleting a user and their uploads (%s)",
  (dialect: TestDialect) => {
    it("keeps the files and clears only the attribution", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "departing-1",
        email: "departing-1@test.local",
      });
      await insertMediaOwnedBy(handle, "departing-1", "kept-logo");

      // The fixture control, and it carries the test. If the row were not
      // stored against this user, deleting the user would leave it untouched
      // for a reason that has nothing to do with the detach under test, and the
      // assertion below would pass on a file no cascade could ever have
      // reached.
      const before = await readMediaRow(handle, "kept-logo");
      expect(before?.uploadedBy).toBe("departing-1");

      await handle.nextly.users.delete({ id: "departing-1" });

      // The second control: the user really is gone. A delete that silently
      // failed leaves the media row present for the wrong reason.
      const remainingUsers = (await handle.adapter.select("users", {
        where: { and: [{ column: "id", op: "=", value: "departing-1" }] },
      })) as unknown[];
      expect(remainingUsers).toHaveLength(0);

      const after = await readMediaRow(handle, "kept-logo");
      expect(after, "the file must outlive the account").toBeDefined();
      expect(after?.uploadedBy).toBeNull();
    });

    it("records the detach as a media change, not a silent write", async () => {
      // A detach IS a metadata change, and `updateMedia` emits two things for
      // any other one: a fresh `updatedAt` and a `media.updated` outbox row.
      // Without them a timestamp-based sync sees an unchanged row and media
      // subscribers are never told, so a downstream replica goes on serving the
      // attribution of an account that no longer exists — the erasure holding
      // on this side of the wire and not on the other.
      current = await createTestNextly({ dialect });
      const handle = current;

      await handle.adapter.insert("users", {
        id: "departing-3",
        email: "departing-3@test.local",
      });
      await insertMediaOwnedBy(handle, "departing-3", "evented");

      // The control on the timestamp assertion: the row really starts stamped
      // in the past, so a detach that does not touch it cannot pass below.
      const stampBefore = (
        (await handle.adapter.select("media", {
          where: { and: [{ column: "id", op: "=", value: "evented" }] },
        })) as Array<{ updatedAt: Date | string }>
      )[0]?.updatedAt;
      expect(new Date(stampBefore as string).getTime()).toBe(
        STORED_AT.getTime()
      );

      await handle.nextly.users.delete({ id: "departing-3" });

      const events = (await handle.adapter.select("nextly_events", {
        where: { and: [{ column: "type", op: "=", value: "media.updated" }] },
      })) as Array<{ type: string; resourceId?: string }>;
      expect(
        events.some(event => event.resourceId === "evented"),
        "the detach must appear in the outbox as a media change"
      ).toBe(true);

      const stampAfter = (
        (await handle.adapter.select("media", {
          where: { and: [{ column: "id", op: "=", value: "evented" }] },
        })) as Array<{ updatedAt: Date | string }>
      )[0]?.updatedAt;
      // Strictly greater, against a fixed past stamp. Comparing against a
      // freshly-written one would be satisfied by a timestamp that never moved.
      expect(new Date(stampAfter as string).getTime()).toBeGreaterThan(
        STORED_AT.getTime()
      );
    });

    it("leaves another account's files attributed", async () => {
      current = await createTestNextly({ dialect });
      const handle = current;

      for (const id of ["departing-2", "staying-2"]) {
        await handle.adapter.insert("users", {
          id,
          email: `${id}@test.local`,
        });
      }
      await insertMediaOwnedBy(handle, "departing-2", "theirs");
      await insertMediaOwnedBy(handle, "staying-2", "not-theirs");

      await handle.nextly.users.delete({ id: "departing-2" });

      // The detach is scoped by uploader. A `where` that lost its predicate
      // would still pass the test above — every file survives — while silently
      // stripping the attribution off the whole library.
      expect((await readMediaRow(handle, "theirs"))?.uploadedBy).toBeNull();
      expect((await readMediaRow(handle, "not-theirs"))?.uploadedBy).toBe(
        "staying-2"
      );
    });
  }
);
