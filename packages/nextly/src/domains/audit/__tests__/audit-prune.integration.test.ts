/**
 * Pruning the two audit trails, against a real database.
 *
 * The column reference is why this is an integration test rather than a unit
 * one. `ActivityLogService` READS these tables with `createdAt` while its
 * never-called cleanup WROTE `created_at`; the two disagreed and only one was
 * ever executed, so neither proved anything about the other. A prune naming the
 * column wrongly deletes nothing and returns cleanly, and since the pass
 * absorbs its own failures that silence is indistinguishable from an install
 * with nothing to prune.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { pruneAuditData } from "../prune";
import { resolveAuditRetentionConfig } from "../retention-config";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const DAY_MS = 24 * 60 * 60 * 1000;

type AuditTable = "activity_log" | "audit_log";

/** Insert a row into one of the trails, aged `daysAgo` days. */
async function seed(
  handle: TestNextly,
  table: AuditTable,
  id: string,
  daysAgo: number
): Promise<void> {
  const createdAt = new Date(Date.now() - daysAgo * DAY_MS);
  await handle.adapter.insert(
    table,
    table === "activity_log"
      ? {
          id,
          userId: "u-seed",
          action: "create",
          collection: "posts",
          createdAt,
        }
      : { id, kind: "login-failed", createdAt }
  );
}

async function idsIn(handle: TestNextly, table: AuditTable): Promise<string[]> {
  const rows = await handle.adapter.select<{ id: string }>(table);
  return rows.map(row => row.id).sort();
}

describe("pruneAuditData (integration)", () => {
  it("removes rows past the window and keeps rows inside it", async () => {
    current = await createTestNextly({ collections: [] });
    await seed(current, "activity_log", "activity-old", 120);
    await seed(current, "activity_log", "activity-fresh", 10);
    await seed(current, "audit_log", "auth-old", 400);
    await seed(current, "audit_log", "auth-fresh", 100);

    const result = await pruneAuditData(
      { adapter: current.adapter },
      resolveAuditRetentionConfig()
    );

    // A count of zero here is the failure this suite exists for: it is what a
    // wrong column reference produces, and it reports success.
    expect(result).toEqual({ activity: 1, auth: 1 });
    expect(await idsIn(current, "activity_log")).toEqual(["activity-fresh"]);
    expect(await idsIn(current, "audit_log")).toEqual(["auth-fresh"]);
  });

  it("keeps auth history when only the activity window is set", async () => {
    // The windows are independent because bounding the high-volume feed while
    // keeping security history indefinitely is a reasonable, common position.
    current = await createTestNextly({ collections: [] });
    await seed(current, "activity_log", "activity-old", 120);
    await seed(current, "audit_log", "auth-ancient", 5000);

    const result = await pruneAuditData(
      { adapter: current.adapter },
      resolveAuditRetentionConfig({ authMaxAgeMs: false })
    );

    expect(result).toEqual({ activity: 1, auth: 0 });
    expect(await idsIn(current, "audit_log")).toEqual(["auth-ancient"]);
  });

  it("deletes nothing when retention is switched off entirely", async () => {
    current = await createTestNextly({ collections: [] });
    await seed(current, "activity_log", "activity-ancient", 5000);
    await seed(current, "audit_log", "auth-ancient", 5000);

    const result = await pruneAuditData(
      { adapter: current.adapter },
      resolveAuditRetentionConfig(false)
    );

    expect(result).toEqual({ activity: 0, auth: 0 });
    expect(await idsIn(current, "activity_log")).toEqual(["activity-ancient"]);
    expect(await idsIn(current, "audit_log")).toEqual(["auth-ancient"]);
  });

  it("honours a window no default would produce", async () => {
    // A non-default number, so this cannot pass on a default the resolver
    // supplied rather than on the value under test.
    current = await createTestNextly({ collections: [] });
    await seed(current, "activity_log", "activity-8d", 8);
    await seed(current, "activity_log", "activity-2d", 2);

    const result = await pruneAuditData(
      { adapter: current.adapter },
      resolveAuditRetentionConfig({
        activityMaxAgeMs: 5 * DAY_MS,
        authMaxAgeMs: false,
      })
    );

    expect(result.activity).toBe(1);
    expect(await idsIn(current, "activity_log")).toEqual(["activity-2d"]);
  });

  it("stops at the batch budget rather than sweeping the backlog", async () => {
    // The first pass on an install that has never pruned faces every row ever
    // written, and it runs off a user's save.
    current = await createTestNextly({ collections: [] });
    for (let i = 0; i < 3; i += 1) {
      await seed(current, "activity_log", `activity-${i}`, 120);
    }

    const result = await pruneAuditData(
      { adapter: current.adapter },
      resolveAuditRetentionConfig({ authMaxAgeMs: false }),
      0
    );

    expect(result.activity).toBe(0);
    expect((await idsIn(current, "activity_log")).length).toBe(3);
  });

  it("prunes the auth trail even when activity fills its whole budget", async () => {
    // A shared budget starved this permanently: writes offer a two-batch pass,
    // activity ages far faster than auth, and an install retiring a batch-worth
    // of activity per interval would consume the allowance before auth was
    // reached — every time, so the auth trail would never be pruned while
    // appearing configured.
    current = await createTestNextly({ collections: [] });
    for (let i = 0; i < 3; i += 1) {
      await seed(current, "activity_log", `activity-${i}`, 120);
    }
    await seed(current, "audit_log", "auth-old", 400);

    const result = await pruneAuditData(
      { adapter: current.adapter },
      resolveAuditRetentionConfig(),
      1
    );

    expect(result.auth).toBe(1);
    expect(await idsIn(current, "audit_log")).toEqual([]);
  });
});
