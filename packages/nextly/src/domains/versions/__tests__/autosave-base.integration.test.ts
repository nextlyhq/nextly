/**
 * Whether a recovery point is from an older version of its document, and
 * whose, as the server answers it from the counters it keeps.
 *
 * Against each configured dialect, because the base is two new columns the
 * three Drizzle schemas declare and each dialect creates its own way, and the
 * answer is read back through the repository the autosave route uses.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { VersionsRepository, type VersionRef } from "../versions-repository";

describe.each(getConfiguredTestDialects())(
  "a recovery point's base on %s",
  dialect => {
    let handle: TestNextly;
    let repo: VersionsRepository;
    let seq = 0;

    beforeAll(async () => {
      handle = await createTestNextly({ dialect });
      repo = new VersionsRepository(handle.adapter);
    });

    afterAll(async () => {
      await handle.destroy();
    });

    /** A fresh document, so each case starts from nothing. */
    const doc = (scopeKind: VersionRef["scopeKind"] = "collection") => {
      seq += 1;
      return {
        scopeKind,
        scopeSlug: "autosavebase",
        entryId: `e-autosavebase-${dialect}-${seq}`,
      } satisfies VersionRef;
    };

    /** The author's point, with the verdict the read would attach. */
    const verdict = async (ref: VersionRef, author: string) => {
      const point = await repo.findAutosave(ref, author);
      if (point === undefined) throw new Error("no recovery point stored");
      return repo.autosaveSupersession(point);
    };

    const durable = (ref: VersionRef, versionNo: number, createdBy: string) =>
      repo.insertVersion({
        ref,
        versionNo,
        status: "draft",
        isAutosave: false,
        snapshot: { v: versionNo },
        createdBy,
      });

    const autosave = (ref: VersionRef, author: string, v: number) =>
      repo.upsertAutosave({
        ref,
        status: "draft",
        snapshot: { v },
        createdBy: author,
      });

    it("is current while nothing has written the document since", async () => {
      const ref = doc();
      await durable(ref, 1, "u1");
      await autosave(ref, "u1", 10);
      expect(await verdict(ref, "u1")).toBeUndefined();
    });

    it("is overtaken by its own author when only they saved since", async () => {
      const ref = doc();
      await durable(ref, 1, "u1");
      await autosave(ref, "u1", 10);
      await durable(ref, 2, "u1");
      expect(await verdict(ref, "u1")).toBe("by-you");
    });

    it("is overtaken by another when anyone else saved since", async () => {
      const ref = doc();
      await durable(ref, 1, "u1");
      await autosave(ref, "u1", 10);
      await durable(ref, 2, "u2");
      expect(await verdict(ref, "u1")).toBe("by-another");
    });

    it("counts a working-draft change as no one's in particular", async () => {
      // Beside a save of the author's own, so only the draft can make it
      // anyone else's: the draft row records who began it, not who changed it.
      const ref = doc();
      await autosave(ref, "u1", 10);
      await durable(ref, 1, "u1");
      await repo.upsertWorkingDraft({
        ref,
        locale: null,
        snapshot: { v: 11 },
        createdBy: "u1",
      });
      expect(await verdict(ref, "u1")).toBe("by-another");
    });

    it("keeps the base it began from through its rewrites", async () => {
      // A write after the point began must not become its base on the next
      // rewrite, or the older work would read as current.
      const ref = doc();
      await autosave(ref, "u1", 10);
      await durable(ref, 1, "u2");
      await autosave(ref, "u1", 11);
      expect(await verdict(ref, "u1")).toBe("by-another");
    });

    it("cannot say for a point recorded before the base existed", async () => {
      const ref = doc();
      await autosave(ref, "u1", 10);
      await handle.adapter.update(
        "nextly_versions",
        { baseVersionNo: null, baseDraftRevision: null },
        {
          and: [
            { column: "entryId", op: "=", value: ref.entryId },
            { column: "isAutosave", op: "=", value: true },
          ],
        }
      );
      expect(await verdict(ref, "u1")).toBe("unknown");
    });

    it("takes a base when a point recorded before the base is next rewritten", async () => {
      // Otherwise it reads as from an older version for as long as the author
      // keeps typing into it.
      const ref = doc();
      await durable(ref, 1, "u1");
      await autosave(ref, "u1", 10);
      await handle.adapter.update(
        "nextly_versions",
        { baseVersionNo: null, baseDraftRevision: null },
        {
          and: [
            { column: "entryId", op: "=", value: ref.entryId },
            { column: "isAutosave", op: "=", value: true },
          ],
        }
      );
      await autosave(ref, "u1", 11);
      expect(await verdict(ref, "u1")).toBeUndefined();
    });

    it("sees an existing working draft rewritten after the point began", async () => {
      const ref = doc();
      const draft = (v: number) =>
        repo.upsertWorkingDraft({
          ref,
          locale: null,
          snapshot: { v },
          createdBy: "u1",
        });
      await draft(1);
      await autosave(ref, "u1", 10);
      expect(await verdict(ref, "u1")).toBeUndefined();
      await draft(2);
      expect(await verdict(ref, "u1")).toBe("by-another");
    });

    it("counts a version retention pruned as someone else's", async () => {
      // The author's own newer version survives, another's between was pruned:
      // what is left could not say who wrote the gap.
      const ref = doc();
      await durable(ref, 1, "u1");
      await autosave(ref, "u1", 10);
      await durable(ref, 2, "u2");
      await durable(ref, 3, "u1");
      await handle.adapter.delete("nextly_versions", {
        and: [
          { column: "entryId", op: "=", value: ref.entryId },
          { column: "versionNo", op: "=", value: 2 },
        ],
      });
      expect(await verdict(ref, "u1")).toBe("by-another");
    });

    it("reads no long history to answer, past which the point is someone else's", async () => {
      const ref = doc();
      await autosave(ref, "u1", 10);
      for (let v = 1; v <= 21; v += 1) await durable(ref, v, "u1");
      expect(await verdict(ref, "u1")).toBe("by-another");
    });

    it("takes the new language's base when the point moves to it", async () => {
      const ref = doc();
      await repo.upsertWorkingDraft({
        ref,
        locale: "fr",
        snapshot: { v: 1 },
        createdBy: "u2",
      });
      const recordIn = (locale: string, v: number) =>
        repo.upsertAutosave({
          ref,
          status: "draft",
          snapshot: { v },
          locale,
          createdBy: "u1",
        });
      await recordIn("en", 10);
      await recordIn("fr", 11);
      // Nothing written since it began in French.
      expect(await verdict(ref, "u1")).toBeUndefined();
    });

    it("answers for a Single as for a collection's entry", async () => {
      const ref = doc("single");
      await autosave(ref, "u1", 10);
      await durable(ref, 1, "u2");
      expect(await verdict(ref, "u1")).toBe("by-another");
    });
  }
);
