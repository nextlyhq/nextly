/**
 * The copy a create's validators are told is minted from the caller's read
 * of the source alone: a look-alike of the same shape is no copy, the forms
 * follow what that read showed the caller, and the fields are the ones it
 * returned.
 */
import { describe, expect, it } from "vitest";

import { copiedFromOf, readSourceCopy } from "./copied-from";

const read = (data: Record<string, unknown>) => ({
  success: true,
  statusCode: 200,
  message: "Found",
  data,
});

describe("the copy a create is told", () => {
  it("is only one minted from a read, never a look-alike", () => {
    const minted = readSourceCopy(
      { collection: "pages", id: "p1" },
      read({ id: "p1", content: {} })
    );
    expect(copiedFromOf(minted)).toBe(minted);
    // The same shape, made any other way.
    expect(copiedFromOf({ ...minted })).toBeUndefined();
    expect(
      copiedFromOf({
        collection: "pages",
        id: "p1",
        forms: ["published", "draft"],
        fields: ["content"],
      })
    ).toBeUndefined();
    expect(copiedFromOf(undefined)).toBeUndefined();
    expect(Object.isFrozen(minted)).toBe(true);
  });

  it("names the draft only where the read showed it to the caller", () => {
    const live = readSourceCopy(
      { collection: "pages", id: "p1" },
      read({ id: "p1", content: {} })
    );
    expect(live.forms).toEqual(["published"]);
    const shown = readSourceCopy(
      { collection: "pages", id: "p1" },
      read({ id: "p1", content: {}, _isWorkingDraft: true })
    );
    expect(shown.forms).toEqual(["published", "draft"]);
  });

  it("names the fields the read returned, and the field the create named", () => {
    const copy = readSourceCopy(
      { collection: "pages", id: "p1", field: "content" },
      read({ id: "p1", title: "T", content: {}, hidden: undefined })
    );
    expect(copy.fields).toEqual(["id", "title", "content"]);
    expect(copy.field).toBe("content");
    expect(
      readSourceCopy({ collection: "pages", id: "p1" }, read({ id: "p1" }))
    ).not.toHaveProperty("field");
  });

  it("names each field inside a group, and none a read rule withheld", () => {
    // The read kept the group and withheld its `content`.
    const copy = readSourceCopy(
      { collection: "pages", id: "p1", field: "hero.content" },
      read({ id: "p1", hero: { title: "T" }, rows: [{ a: 1 }] })
    );
    expect(copy.fields).toEqual(["id", "hero", "hero.title", "rows"]);
    expect(copy.fields).not.toContain("hero.content");
  });

  it("refuses to mint a copy from a read that failed", () => {
    expect(() =>
      readSourceCopy(
        { collection: "pages", id: "p1" },
        { success: false, statusCode: 404, message: "Not found", data: null }
      )
    ).toThrow();
  });
});
