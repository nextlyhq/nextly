import { describe, it, expect } from "vitest";

import { createTestNextly } from "../../../plugins/test-nextly";
import { VersionsRepository, type VersionRef } from "../versions-repository";

// The working draft is a sidecar row in nextly_versions (status='draft',
// version_no NULL, is_autosave=false), one per document per locale. It lets a
// published document be edited without changing the live row until publish
// promotes it. These tests prove it coexists with durable history without
// corrupting the durable reads, which assume a non-autosave row carries a
// version number.
describe("working-draft repository (integration)", () => {
  const ref: VersionRef = {
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e-wd-1",
  };

  const sortedNos = (rows: { versionNo: number | null }[]): (number | null)[] =>
    [...rows.map(r => r.versionNo)].sort((a, b) => Number(a) - Number(b));

  it("coalesces to one working draft per document+locale and finds it", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);

      await repo.upsertWorkingDraft({
        ref,
        locale: null,
        snapshot: { title: "first" },
        createdBy: "u1",
      });
      // A second save for the same (document, locale) rewrites the SAME row in
      // place rather than adding another.
      await repo.upsertWorkingDraft({
        ref,
        locale: null,
        snapshot: { title: "second" },
        createdBy: "u2",
      });

      const found = await repo.findWorkingDraft(ref, null);
      expect(found?.snapshot).toEqual({ title: "second" });
      expect(found?.status).toBe("draft");
      expect(found?.versionNo).toBeNull();
      expect(found?.isAutosave).toBe(false);
      expect(found?.createdBy).toBe("u2");

      // Exactly one working-draft row exists for this document+locale.
      const rows = await handle.adapter.select<{ id: string }>(
        "nextly_versions",
        {
          where: {
            and: [
              { column: "entryId", op: "=", value: ref.entryId },
              { column: "isAutosave", op: "=", value: false },
              { column: "versionNo", op: "IS NULL" },
            ],
          },
        }
      );
      expect(rows).toHaveLength(1);
    } finally {
      await handle.destroy();
    }
  });

  it("does not corrupt getMaxVersionNo, retention, or history", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);

      // Two durable published versions.
      await repo.insertVersion({
        ref,
        versionNo: 1,
        status: "published",
        isAutosave: false,
        snapshot: { v: 1 },
      });
      await repo.insertVersion({
        ref,
        versionNo: 2,
        status: "published",
        isAutosave: false,
        snapshot: { v: 2 },
      });
      // A working draft on top of the published history.
      await repo.upsertWorkingDraft({
        ref,
        locale: null,
        snapshot: { draft: true },
        createdBy: "u1",
      });

      // The working draft must NOT be seen as the latest durable version, or the
      // next durable capture would allocate a colliding number.
      expect(await repo.getMaxVersionNo(ref)).toBe(2);

      // History excludes the working draft (surfaced via findWorkingDraft, not
      // as a phantom null-versionNo history entry).
      expect(sortedNos(await repo.listByDoc(ref))).toEqual([1, 2]);

      // Retention candidates exclude the working draft (never counted toward the
      // cap, never pruned as if it were history).
      expect(sortedNos(await repo.listDurableForPrune(ref))).toEqual([1, 2]);
    } finally {
      await handle.destroy();
    }
  });

  it("scopes the working draft per locale and deletes one locale independently", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);

      await repo.upsertWorkingDraft({
        ref,
        locale: "en",
        snapshot: { l: "en" },
        createdBy: "u1",
      });
      await repo.upsertWorkingDraft({
        ref,
        locale: "de",
        snapshot: { l: "de" },
        createdBy: "u1",
      });

      expect((await repo.findWorkingDraft(ref, "en"))?.snapshot).toEqual({
        l: "en",
      });
      expect((await repo.findWorkingDraft(ref, "de"))?.snapshot).toEqual({
        l: "de",
      });

      const deleted = await repo.deleteWorkingDraft(ref, "en");
      expect(deleted).toBe(1);
      expect(await repo.findWorkingDraft(ref, "en")).toBeUndefined();
      expect(await repo.findWorkingDraft(ref, "de")).toBeTruthy();
    } finally {
      await handle.destroy();
    }
  });
});
