/**
 * A document has at most one working draft per locale, and the database is what
 * makes that true. The repository reads before it writes, but nothing holds a
 * lock across that read: the only locking read in the enclosing write flow sits
 * inside the status-transition guard, which returns immediately when the write
 * names no status, and a working-draft save always names none. So two writers
 * can both observe no draft and both insert, and only a constraint can refuse
 * the second.
 *
 * These run against a real PostgreSQL because a second connection is the whole
 * point; SQLite serializes its writers and cannot express the case.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isDatabaseError } from "@nextlyhq/adapter-drizzle/types";

import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { VersionsRepository, type VersionRef } from "../versions-repository";

const describeIfPg = process.env.TEST_POSTGRES_URL ? describe : describe.skip;

describeIfPg("working-draft uniqueness (integration)", () => {
  let handle: TestNextly;

  beforeAll(async () => {
    handle = await createTestNextly({ dialect: "postgresql" });
  });

  afterAll(async () => {
    await handle.destroy();
  });

  const workingDraftRows = (entryId: string) =>
    handle.adapter.select<{ id: string; snapshot: unknown; draftKey: string }>(
      "nextly_versions",
      {
        where: {
          and: [
            { column: "entryId", op: "=", value: entryId },
            { column: "isAutosave", op: "=", value: false },
            { column: "versionNo", op: "IS NULL" },
          ],
        },
      }
    );

  it("keeps exactly one working draft when two transactions interleave", async () => {
    const ref: VersionRef = {
      scopeKind: "collection",
      scopeSlug: "wduniq",
      entryId: "e-wduniq-1",
    };

    // The interleaving is forced rather than raced. Each transaction reads
    // before either writes, which is exactly what the production path permits:
    // the working-draft save runs inside a transaction and takes no lock on the
    // document, so neither writer can see the other's uncommitted row. Racing
    // two calls and hoping they overlap proves nothing when they happen not to.
    let readA = (): void => {};
    let readB = (): void => {};
    const hasReadA = new Promise<void>(resolve => (readA = resolve));
    const hasReadB = new Promise<void>(resolve => (readB = resolve));

    // Two transactions on the booted adapter's pool, which is what two HTTP
    // requests are: each checks out its own connection, so neither sees the
    // other's uncommitted row.
    const write = async (
      title: string,
      announce: () => void,
      waitForOther: Promise<void>
    ): Promise<void> => {
      await handle.adapter.transaction(async tx => {
        // Open the transaction and take its snapshot before anyone writes.
        await tx.select("nextly_versions", {
          where: { and: [{ column: "entryId", op: "=", value: ref.entryId }] },
          limit: 1,
        });
        announce();
        await waitForOther;
        await new VersionsRepository(tx).upsertWorkingDraft({
          ref,
          locale: null,
          snapshot: { title },
          createdBy: title,
        });
      });
    };

    const outcomes = await Promise.allSettled([
      write("from A", readA, hasReadB),
      write("from B", readB, hasReadA),
    ]);

    // One writer commits and the other is refused. Which one loses depends on
    // who reaches the insert second and is not worth pinning; what matters is
    // that the loser is TOLD, rather than both landing and a later read picking
    // between them arbitrarily.
    const rejected = outcomes.filter(o => o.status === "rejected");
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(isDatabaseError(reason) && reason.kind === "unique_violation").toBe(
      true
    );

    expect(await workingDraftRows(ref.entryId)).toHaveLength(1);
  });

  it("does not constrain durable or autosave rows", async () => {
    const ref: VersionRef = {
      scopeKind: "collection",
      scopeSlug: "wduniq",
      entryId: "e-wduniq-3",
    };
    const repo = new VersionsRepository(handle.adapter);
    // Two durable rows and two authors' autosave rows for one document all
    // carry a NULL draft_key, so the unique index must ignore them entirely.
    await repo.insertVersion({
      ref,
      versionNo: 1,
      status: "published",
      isAutosave: false,
      snapshot: { v: 1 },
      createdBy: "u1",
    });
    await repo.insertVersion({
      ref,
      versionNo: 2,
      status: "published",
      isAutosave: false,
      snapshot: { v: 2 },
      createdBy: "u1",
    });
    await repo.upsertAutosave({
      ref,
      status: "draft",
      snapshot: { v: 3 },
      createdBy: "u1",
    });
    await repo.upsertAutosave({
      ref,
      status: "draft",
      snapshot: { v: 4 },
      createdBy: "u2",
    });

    const rows = await handle.adapter.select<{ id: string }>(
      "nextly_versions",
      { where: { and: [{ column: "entryId", op: "=", value: ref.entryId }] } }
    );
    expect(rows).toHaveLength(4);
  });
});
