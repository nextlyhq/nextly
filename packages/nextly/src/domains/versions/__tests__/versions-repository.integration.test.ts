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
      expect("snapshot" in list[0]).toBe(false);
    } finally {
      await handle.destroy();
    }
  });

  it("scopes listByDoc to one locale when asked", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);
      // A localized document captures a version per locale, interleaved.
      const insert = (versionNo: number, locale: string) =>
        repo.insertVersion({
          ref,
          versionNo,
          status: "published",
          isAutosave: false,
          snapshot: { title: `v${versionNo}` },
          createdBy: "user-1",
          locale,
        });
      await insert(1, "en");
      await insert(2, "fr");
      await insert(3, "en");

      // Unfiltered returns every locale's versions, newest first.
      const all = await repo.listByDoc(ref);
      expect(all.map(m => m.versionNo)).toEqual([3, 2, 1]);

      // Filtered returns only the requested locale, preserving order.
      const en = await repo.listByDoc(ref, { locale: "en" });
      expect(en.map(m => m.versionNo)).toEqual([3, 1]);
      expect(en.every(m => m.locale === "en")).toBe(true);

      const fr = await repo.listByDoc(ref, { locale: "fr" });
      expect(fr.map(m => m.versionNo)).toEqual([2]);

      // A locale with no versions returns nothing rather than every row.
      const de = await repo.listByDoc(ref, { locale: "de" });
      expect(de).toEqual([]);
    } finally {
      await handle.destroy();
    }
  });

  it("includes shared (null-locale) versions in a locale filter", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);
      const insert = (versionNo: number, locale?: string) =>
        repo.insertVersion({
          ref,
          versionNo,
          status: "published",
          isAutosave: false,
          snapshot: { title: `v${versionNo}` },
          createdBy: "user-1",
          ...(locale ? { locale } : {}),
        });
      await insert(1, "en");
      await insert(2); // shared write: no locale-specific state, so locale null
      await insert(3, "fr");
      await insert(4, "en");

      // Filtering to "en" returns the en-specific versions AND the shared one,
      // newest first — a shared change affects every locale's history.
      const en = await repo.listByDoc(ref, { locale: "en" });
      expect(en.map(m => m.versionNo)).toEqual([4, 2, 1]);

      // "fr" gets its own version plus the same shared one, but not the en ones.
      const fr = await repo.listByDoc(ref, { locale: "fr" });
      expect(fr.map(m => m.versionNo)).toEqual([3, 2]);
    } finally {
      await handle.destroy();
    }
  });

  it("rejects a duplicate durable version_no for the same document", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);
      const dupRef: VersionRef = {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "entry-dup",
      };
      await repo.insertVersion({
        ref: dupRef,
        versionNo: 1,
        status: "published",
        isAutosave: false,
        snapshot: {},
        createdBy: "user-1",
      });
      // The durable-sequence unique index (partial on Postgres, full/NULL-
      // tolerant on MySQL/SQLite) must reject a second row with the same
      // version_no for the same document.
      await expect(
        repo.insertVersion({
          ref: dupRef,
          versionNo: 1,
          status: "published",
          isAutosave: false,
          snapshot: {},
          createdBy: "user-1",
        })
      ).rejects.toThrow();
    } finally {
      await handle.destroy();
    }
  });

  it("rejects an autosave that carries a version number", async () => {
    const handle = await createTestNextly();
    try {
      const repo = new VersionsRepository(handle.adapter);
      // Autosave rows must have a null version_no (the durable-sequence unique
      // index treats a non-null version_no as a durable row).
      await expect(
        repo.insertVersion({
          ref: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "entry-bad-autosave",
          },
          versionNo: 3,
          status: "draft",
          isAutosave: true,
          snapshot: {},
          createdBy: "user-1",
        })
      ).rejects.toThrow();
    } finally {
      await handle.destroy();
    }
  });
});
