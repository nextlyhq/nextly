// The review-state and workflow-settings tables, written and read back through their repositories
// on every configured dialect: a row per part (the shared part and each language), a write over a
// revision someone else moved refused, and the settings record's compare-and-set.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  createReviewState,
  deleteDocumentReviewStates,
  deleteEntityReviewStates,
  readDocumentReviewStates,
  readReviewState,
  type ReviewPart,
  type ReviewStatesDb,
  updateReviewState,
} from "../review-state-repository";
import {
  readWorkflowSettings,
  writeWorkflowSettings,
} from "../workflow-settings-repository";

const DOC = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
} as const;
const SHARED: ReviewPart = { ...DOC, part: null };
const EN: ReviewPart = { ...DOC, part: "en" };
const ES: ReviewPart = { ...DOC, part: "es" };
// Whole seconds: SQLite stores timestamps to the second.
const AT = new Date("2026-11-02T10:00:00.000Z");

describe.each(getConfiguredTestDialects())(
  "review state and workflow settings repositories (%s)",
  dialect => {
    let handle: TestNextly;
    let db: ReviewStatesDb;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      db = handle.adapter as unknown as ReviewStatesDb;
    });

    afterEach(async () => {
      await handle?.destroy();
    });

    it("keeps one row per part, the shared part included, and reads each back", async () => {
      for (const part of [SHARED, EN, ES]) {
        await createReviewState(db, part, {
          stage: part.part === "es" ? "inReview" : "drafting",
          enteredAt: AT,
          enteredBy: "u1",
          definitionHash: "h1",
        });
      }

      expect(await readReviewState(db, SHARED)).toMatchObject({
        part: null,
        stage: "drafting",
        enteredBy: "u1",
        revision: 1,
      });
      expect((await readReviewState(db, ES))?.stage).toBe("inReview");
      expect((await readReviewState(db, EN))?.enteredAt.getTime()).toBe(
        AT.getTime()
      );
      expect(
        (await readDocumentReviewStates(db, DOC)).map(s => s.part).sort()
      ).toEqual(["en", "es", null].sort());
      // The unique index: a second first state for a part is refused.
      await expect(
        createReviewState(db, EN, {
          stage: "drafting",
          enteredAt: AT,
          definitionHash: "h1",
        })
      ).rejects.toThrow();
    });

    it("applies a step over the revision it read, and refuses one over a revision since moved", async () => {
      await createReviewState(db, EN, {
        stage: "drafting",
        enteredAt: AT,
        definitionHash: "h1",
      });
      const approval = { versionNo: 3, digest: "d1", by: "u2", at: AT };

      expect(
        await updateReviewState(db, EN, 1, {
          stage: "approved",
          approval,
          assignee: { kind: "role", id: "editors" },
        })
      ).toBe(true);
      // Another step judged at revision 1 lands nowhere.
      expect(await updateReviewState(db, EN, 1, { stage: "drafting" })).toBe(
        false
      );

      expect(await readReviewState(db, EN)).toMatchObject({
        stage: "approved",
        approval,
        assignee: { kind: "role", id: "editors" },
        revision: 2,
      });
      // Clearing the approval and the assignee.
      expect(
        await updateReviewState(db, EN, 2, { approval: null, assignee: null })
      ).toBe(true);
      expect(await readReviewState(db, EN)).toMatchObject({
        approval: null,
        assignee: null,
        revision: 3,
      });
    });

    it("removes a document's rows, and an entity's, leaving others", async () => {
      const other: ReviewPart = { ...DOC, entryId: "e2", part: "en" };
      const elsewhere: ReviewPart = { ...DOC, scopeSlug: "pages", part: "en" };
      for (const part of [EN, ES, other, elsewhere]) {
        await createReviewState(db, part, {
          stage: "drafting",
          enteredAt: AT,
          definitionHash: "h1",
        });
      }

      expect(await deleteDocumentReviewStates(db, DOC)).toBe(2);
      expect(await readReviewState(db, other)).not.toBeNull();
      expect(
        await deleteEntityReviewStates(db, {
          scopeKind: "collection",
          scopeSlug: "posts",
        })
      ).toBe(1);
      expect(await readReviewState(db, elsewhere)).not.toBeNull();
    });

    it("writes a workflow's settings over the revision it read, and refuses a stale one", async () => {
      expect(await readWorkflowSettings(db, "review")).toBeNull();
      const first = {
        defaultReviewers: {
          inReview: { kind: "role" as const, id: "editors" },
        },
      };
      expect(await writeWorkflowSettings(db, "review", first, null, "u1")).toBe(
        true
      );
      // A second first write finds the row.
      expect(await writeWorkflowSettings(db, "review", {}, null, "u1")).toBe(
        false
      );
      expect(await readWorkflowSettings(db, "review")).toEqual({
        settings: first,
        revision: 1,
      });

      const second = { ...first, emails: { approved: false } };
      expect(await writeWorkflowSettings(db, "review", second, 1, "u2")).toBe(
        true
      );
      expect(await writeWorkflowSettings(db, "review", first, 1, "u3")).toBe(
        false
      );
      expect(await readWorkflowSettings(db, "review")).toEqual({
        settings: second,
        revision: 2,
      });
    });

    it("refuses settings outside their shape", async () => {
      await expect(
        writeWorkflowSettings(
          db,
          "review",
          { emails: { approved: "no" } } as never,
          null,
          "u1"
        )
      ).rejects.toThrow();
      expect(await readWorkflowSettings(db, "review")).toBeNull();
    });
  }
);
