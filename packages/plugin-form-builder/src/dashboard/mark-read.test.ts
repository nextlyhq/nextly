/**
 * Marking a submission read is an update by query, so it says it sets the
 * status whatever is stored: it has no version of its own for each document,
 * and its `where` is what keeps it to a submission still new.
 */
import { describe, expect, it } from "vitest";

import { markReadRequest } from "./mark-read";

describe("the mark-read request", () => {
  it("sets the status as an overwrite, kept to a submission still new by its where", () => {
    const { init } = markReadRequest("form-submissions", "s1");
    expect(JSON.parse(String(init.body))).toEqual({
      where: { id: { equals: "s1" }, status: { equals: "new" } },
      data: { status: "read", _overwrite: true },
    });
  });
});
