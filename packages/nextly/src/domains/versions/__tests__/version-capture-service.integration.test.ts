import { describe, it, expect } from "vitest";

import { createTestNextly } from "../../../plugins/test-nextly";
import { VersionsRepository, type VersionRef } from "../versions-repository";
import { VersionCaptureService } from "../version-capture-service";

const ref: VersionRef = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "entry-cap",
};

describe("VersionCaptureService (integration)", () => {
  it("allocates version_no, inserts in a tx, and round-trips a valid timestamp", async () => {
    const handle = await createTestNextly();
    try {
      const service = new VersionCaptureService();

      const first = await handle.adapter.transaction(async tx =>
        service.capture(tx, {
          ref,
          status: "published",
          snapshot: { title: "one" },
          createdBy: "user-1",
        })
      );
      expect(first.versionNo).toBe(1);

      const second = await handle.adapter.transaction(async tx =>
        service.capture(tx, {
          ref,
          status: "published",
          snapshot: { title: "two" },
          createdBy: "user-1",
        })
      );
      expect(second.versionNo).toBe(2);

      const repo = new VersionsRepository(handle.adapter);
      const list = await repo.listByDoc(ref);
      expect(list.map(m => m.versionNo)).toEqual([2, 1]);

      // Guards the tx-path timestamp fix: createdAt must round-trip to a real,
      // recent Date (a seconds/ms mismatch would land near 1970).
      const newest = list[0];
      expect(newest.createdAt).toBeInstanceOf(Date);
      expect(Date.now() - newest.createdAt.getTime()).toBeLessThan(60_000);

      // The durable snapshot round-trips.
      const v2 = await repo.findByVersionNo(ref, 2);
      expect(v2?.snapshot).toEqual({ title: "two" });
    } finally {
      await handle.destroy();
    }
  });
});
