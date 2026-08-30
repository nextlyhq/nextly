/**
 * The document soft lock against a REAL database.
 *
 * Only an integration test can establish any of this, because every question the
 * lock answers is answered by the database rather than by this code.
 *
 * First, that the table exists at all. It reaches a database through several
 * separate registries, and a miss in any one of them leaves every unit test
 * passing against a table no real installation has.
 *
 * Second, that expiry actually releases. A claim whose holder crashed is
 * takeable because a SQL comparison says so — on the database's clock, in the
 * dialect's own type. A unit test with a mocked transaction cannot tell a
 * working comparison from one that is `NULL` on one dialect and therefore never
 * true.
 *
 * Third, that the fences hold. A renewal or a release arriving from somebody who
 * no longer owns the row must change nothing, and that is a property of the
 * WHERE clause reaching a real row.
 *
 * Runs against whichever dialect the integration run configures; CI covers
 * SQLite, Postgres and MySQL.
 *
 * @module domains/document-lock/__tests__/document-lock-repository.integration.test
 */

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { futureExpression } from "../../../database/lease-clock";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DOCUMENT_LOCK_TABLE } from "../../../schemas/document-lock";
import {
  acquireDocumentLock,
  readDocumentLock,
  releaseDocumentLock,
  renewDocumentLock,
} from "../document-lock-repository";
import { documentLockKey } from "../lock-key";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

const DOC = { collection: "posts", entryId: "entry-1" } as const;
const ADA = { ownerId: "user-ada", ownerLabel: "Ada" };
const GRACE = { ownerId: "user-grace", ownerLabel: "Grace" };

/**
 * Push a claim's expiry into the past.
 *
 * Written with the SAME clock expression the repository writes expiries with,
 * given a negative offset, rather than a timestamp this test builds itself. A
 * hand-built instant would have to be correct in three dialects' types and time
 * zones, which is the exact problem the expression exists to solve — and a test
 * that solves it a second way can pass while the repository's version is broken.
 */
async function expireClaim(app: TestNextly): Promise<void> {
  const dialect = app.adapter.getCapabilities().dialect;
  const key = documentLockKey(DOC.collection, DOC.entryId);
  await app.adapter.transaction(async ctx => {
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          SET ${sql.identifier("expires_at")} = ${futureExpression(dialect, -600)}
          WHERE ${sql.identifier("lock_key")} = ${key}`
    );
  });
}

/**
 * Set a claim's remaining lease to a known number of seconds.
 *
 * The point is to make a RENEWAL observable. A claim taken a moment ago already
 * has nearly the full lease, so extending it changes the remaining span by an
 * amount too small to assert on — and a test that cannot see the extension
 * cannot tell a fenced heartbeat from an unfenced one.
 */
async function setRemaining(app: TestNextly, seconds: number): Promise<void> {
  const dialect = app.adapter.getCapabilities().dialect;
  const key = documentLockKey(DOC.collection, DOC.entryId);
  await app.adapter.transaction(async ctx => {
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          SET ${sql.identifier("expires_at")} = ${futureExpression(dialect, seconds)}
          WHERE ${sql.identifier("lock_key")} = ${key}`
    );
  });
}

describe.each(getConfiguredTestDialects())("document soft lock (%s)", d => {
  it("gives the first author the claim, and says how long it has", async () => {
    const app = await boot(d);
    const got = await acquireDocumentLock(app.adapter, DOC, ADA);

    expect(got.status).toBe("acquired");
    expect(got.holder.ownerId).toBe("user-ada");
    // A positive remaining span, computed by the database. Zero or negative
    // here would mean the expiry was written on a clock the comparison does not
    // read, which is the failure this whole design exists to prevent.
    expect(got.holder.expiresInSeconds).toBeGreaterThan(0);
    expect(got.holder.expiresInSeconds).toBeLessThanOrEqual(150);
  });

  it("refuses a second author and names who is editing", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);

    const got = await acquireDocumentLock(app.adapter, DOC, GRACE);
    expect(got.status).toBe("held");
    // The label is what the interface renders. Returning only an id would make
    // the refusal unactionable for the person reading it.
    expect(got.holder.ownerLabel).toBe("Ada");
    expect(got.holder.ownerId).toBe("user-ada");
  });

  it("lets the SAME author re-acquire, so reopening a tab is not a conflict", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);

    const again = await acquireDocumentLock(app.adapter, DOC, ADA);
    expect(again.status).toBe("acquired");
  });

  it("hands an EXPIRED claim to the next author without asking for a takeover", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);
    await expireClaim(app);

    // No takeover flag. A holder that crashed, closed the laptop or went
    // offline never releases, so expiry alone has to be enough — otherwise the
    // document stays locked by somebody who will never come back.
    const got = await acquireDocumentLock(app.adapter, DOC, GRACE);
    expect(got.status).toBe("acquired");
    expect(got.holder.ownerId).toBe("user-grace");
  });

  it("reports nobody editing once a claim has expired", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);
    expect(await readDocumentLock(app.adapter, DOC)).toBeDefined();

    await expireClaim(app);
    expect(await readDocumentLock(app.adapter, DOC)).toBeUndefined();
  });

  it("transfers the document on a deliberate takeover", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);

    const stolen = await acquireDocumentLock(app.adapter, DOC, GRACE, {
      takeover: true,
    });
    expect(stolen.status).toBe("acquired");
    expect(stolen.holder.ownerId).toBe("user-grace");
    expect((await readDocumentLock(app.adapter, DOC))?.ownerLabel).toBe(
      "Grace"
    );
  });

  it("tells the ousted author it lost the claim, and to whom", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);
    await acquireDocumentLock(app.adapter, DOC, GRACE, { takeover: true });

    const beat = await renewDocumentLock(app.adapter, DOC, ADA);
    expect(beat.status).toBe("lost");
    // Naming the new holder is what lets the interface say "Grace took over"
    // rather than only that something happened.
    expect(beat.holder?.ownerId).toBe("user-grace");
  });

  it("reports a lapsed claim as lost with NOBODY holding it", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);
    await releaseDocumentLock(app.adapter, DOC, ADA);

    const beat = await renewDocumentLock(app.adapter, DOC, ADA);
    expect(beat.status).toBe("lost");
    // Absent rather than present-and-empty. "Nobody has it" leads the editor to
    // offer resuming; "Grace has it" leads it to offer requesting access, and
    // collapsing the two makes one of those wrong.
    expect(beat.holder).toBeUndefined();
  });

  it("does not let a heartbeat from a non-owner extend the owner's claim", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);
    // Wind the lease down first. Asserting on the OWNER after an unfenced
    // renewal proves nothing — an unfenced UPDATE sets `expires_at` and leaves
    // `owner_id` alone, so Ada still owns it either way and the defect is
    // invisible. What an unfenced renewal actually does is extend a lease
    // Grace does not hold, and only the remaining span shows that.
    await setRemaining(app, 30);

    const beat = await renewDocumentLock(app.adapter, DOC, GRACE);
    expect(beat.status).toBe("lost");

    const held = await readDocumentLock(app.adapter, DOC);
    expect(held?.ownerId).toBe("user-ada");
    // Still the wound-down lease. Unfenced, this would have jumped back to the
    // full 150 seconds on a heartbeat from somebody with no claim at all.
    expect(held?.expiresInSeconds).toBeLessThanOrEqual(30);
  });

  it("does not let a non-owner release somebody else's claim", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);

    await releaseDocumentLock(app.adapter, DOC, GRACE);
    // A late release from a previous holder must not free the document out from
    // under whoever took it over.
    expect((await readDocumentLock(app.adapter, DOC))?.ownerId).toBe(
      "user-ada"
    );
  });

  it("frees the document when its owner releases it", async () => {
    const app = await boot(d);
    await acquireDocumentLock(app.adapter, DOC, ADA);
    await releaseDocumentLock(app.adapter, DOC, ADA);

    expect(await readDocumentLock(app.adapter, DOC)).toBeUndefined();
    const next = await acquireDocumentLock(app.adapter, DOC, GRACE);
    expect(next.status).toBe("acquired");
  });
});
