import { describe, it, expect } from "vitest";

import { createTestNextly } from "../../../plugins/test-nextly";
import { VersionsRepository, type VersionRef } from "../versions-repository";

const ref: VersionRef = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "entry-1",
};

describe("VersionsRepository (integration)", () => {
  it("allocates a monotonic version_no and reads rows back", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);

      expect(await repo.getMaxVersionNo(ref)).toBe(0);

      await repo.insertVersion({
        ref,
        versionNo: 1,
        status: "published",
        isAutosave: false,
        snapshot: { title: "v1" },
        createdBy: "user-1",
      });
      await repo.insertVersion({
        ref,
        versionNo: 2,
        status: "published",
        isAutosave: false,
        snapshot: { title: "v2" },
        createdBy: "user-1",
      });

      expect(await repo.getMaxVersionNo(ref)).toBe(2);

      const v1 = await repo.findByVersionNo(ref, 1);
      expect(v1?.snapshot).toEqual({ title: "v1" });

      const list = await repo.listByDoc(ref);
      expect(list.map(m => m.versionNo)).toEqual([2, 1]);
      // listByDoc returns metadata only (no snapshot).
      expect((list[0] as Record<string, unknown>).snapshot).toBeUndefined();
    } finally {
      await handle.destroy();
    }
  });
});
