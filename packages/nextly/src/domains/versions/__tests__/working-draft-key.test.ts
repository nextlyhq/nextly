import { describe, expect, it } from "vitest";

import { nextlyVersionsMysql } from "../../../schemas/versions/mysql";
import { nextlyVersionsPg } from "../../../schemas/versions/postgres";
import { nextlyVersionsSqlite } from "../../../schemas/versions/sqlite";
import type { VersionRef } from "../versions-repository";
import { workingDraftKey } from "../working-draft-key";

const ref = (slug: string, entryId: string): VersionRef => ({
  scopeKind: "collection",
  scopeSlug: slug,
  entryId,
});

describe("workingDraftKey", () => {
  it("is a fixed-width lowercase hex digest", () => {
    expect(workingDraftKey(ref("posts", "e1"), "en")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    expect(workingDraftKey(ref("posts", "e1"), "en")).toBe(
      workingDraftKey(ref("posts", "e1"), "en")
    );
  });

  it("separates one language from another", () => {
    expect(workingDraftKey(ref("posts", "e1"), "en")).not.toBe(
      workingDraftKey(ref("posts", "e1"), "es")
    );
  });

  it("separates an unlocalized document from a localized one", () => {
    expect(workingDraftKey(ref("posts", "e1"), null)).not.toBe(
      workingDraftKey(ref("posts", "e1"), "en")
    );
  });

  it("cannot be forged by moving the delimiter into a segment", () => {
    // Without per-segment encoding, ("posts:a", "e1") and ("posts", "a:e1")
    // would join to the same string and collapse two documents into one key.
    expect(workingDraftKey(ref("posts:a", "e1"), null)).not.toBe(
      workingDraftKey(ref("posts", "a:e1"), null)
    );
  });

  it("separates scope kinds", () => {
    const asSingle: VersionRef = {
      scopeKind: "single",
      scopeSlug: "posts",
      entryId: "e1",
    };
    expect(workingDraftKey(asSingle, null)).not.toBe(
      workingDraftKey(ref("posts", "e1"), null)
    );
  });
});

describe("draft_key column", () => {
  // Declared on every dialect, or the constraint holds on some databases and
  // not others, which is worse than not holding at all: the same code would be
  // correct in development and lossy in production.
  it("is declared on all three dialects", () => {
    expect(nextlyVersionsPg.draftKey.name).toBe("draft_key");
    expect(nextlyVersionsMysql.draftKey.name).toBe("draft_key");
    expect(nextlyVersionsSqlite.draftKey.name).toBe("draft_key");
  });

  it("is nullable on all three dialects", () => {
    expect(nextlyVersionsPg.draftKey.notNull).toBe(false);
    expect(nextlyVersionsMysql.draftKey.notNull).toBe(false);
    expect(nextlyVersionsSqlite.draftKey.notNull).toBe(false);
  });
});
