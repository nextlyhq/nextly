/**
 * The activity feed's permission scope must exclude BOTH sides of a read: the
 * rows a caller may not see.
 *
 * `activity-scope.test.ts` covers this against a mocked adapter, which proves
 * the arguments `getRecentActivity` builds but never executes the SQL
 * `countActivities` emits from them. This runs the same property against a
 * real SQLite database so the IN-clause placeholder/params pairing in
 * `countActivities` is actually exercised end to end, not merely asserted by
 * shape.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { someResources } from "../readable-resources";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("activity feed scope (sqlite integration)", () => {
  it("excludes an unscoped collection from the activities list", async () => {
    current = await createTestNextly({ dialect: "sqlite" });

    // The write path decides identity by checking whether the account still
    // exists, so a real user row is required -- the same shape
    // `mutation-activity.integration.test.ts` uses for its actor.
    const actorId = "scope-actor";
    await current.adapter.insert("users", {
      id: actorId,
      name: "Scope Actor",
      email: "scope-actor@test.local",
      is_active: true,
    });

    const activityLog = current.getService("activityLogService");
    await activityLog.logActivity({
      userId: actorId,
      action: "create",
      collection: "posts",
      entryTitle: "Visible Post",
    });
    await activityLog.logActivity({
      userId: actorId,
      action: "create",
      collection: "pages",
      entryTitle: "Hidden Page",
    });

    const result = await activityLog.getRecentActivity({
      scope: someResources(["posts"]),
      // Required now: the feed authorizes each row's DOCUMENT as this caller,
      // and answers empty without one. These rows name no entry, so the scope
      // is the whole decision for them.
      caller: { user: { id: actorId, roles: [] } },
    });

    expect(result.activities.map(a => a.entryTitle)).toEqual(["Visible Post"]);
    expect(result.activities.some(a => a.entryTitle === "Hidden Page")).toBe(
      false
    );
    // There is no `total` to assert any more. It was a `COUNT(*)` over the
    // rows the COLLECTION scope admitted, so it counted edits to documents the
    // reader may not open, and it cannot be narrowed without authorizing every
    // matching row -- unbounded over an audit table. The count and the
    // hand-written SQL behind it were removed rather than corrected.
    expect(result.hasMore).toBe(false);
  });
});
