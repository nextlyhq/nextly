/**
 * The activity feed's permission scope must exclude BOTH sides of a read: the
 * rows a caller may not see, and the total that counts them.
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
  it("excludes an unscoped collection from both the activities list and the total", async () => {
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
    });

    expect(result.activities.map(a => a.entryTitle)).toEqual(["Visible Post"]);
    expect(result.activities.some(a => a.entryTitle === "Hidden Page")).toBe(
      false
    );
    // `total` is what exercises countActivities' own IN-clause SQL end to
    // end. A placeholder/params mismatch there would leave `activities`
    // correct (a different code path, `adapter.select`) and only this number
    // silently wrong -- exactly the failure mode I-1 describes.
    expect(result.total).toBe(1);
  });
});
