// A collection's save that removes a field holding values deletes only the count the person
// confirmed in its review (`confirmedDeletions`): the server counts again just before it deletes,
// and refuses where a count changed. The apply sends the counts it is given, and leaves the key
// out when the save removes no field.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    post: vi.fn(async () => ({ message: "ok", newSchemaVersion: 2 })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { confirmedDeletionsOf, schemaApi } from "../schemaApi";

const post = protectedApi.post as unknown as ReturnType<typeof vi.fn>;

const bodyOfLastCall = (): Record<string, unknown> =>
  post.mock.calls[post.mock.calls.length - 1][1] as Record<string, unknown>;

const apply = (confirmed?: { field: string; count: number }[]) =>
  schemaApi.apply(
    "posts",
    [],
    1,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    confirmed
  );

describe("a collection's apply", () => {
  beforeEach(() => post.mockClear());

  it("sends the count of each removed field the review confirmed", async () => {
    await apply([{ field: "note", count: 3 }]);
    expect(bodyOfLastCall()).toMatchObject({
      confirmedDeletions: [{ field: "note", count: 3 }],
    });
  });

  it("leaves the key out when the save removes no field", async () => {
    await apply([]);
    expect(bodyOfLastCall()).not.toHaveProperty("confirmedDeletions");
    await apply(undefined);
    expect(bodyOfLastCall()).not.toHaveProperty("confirmedDeletions");
  });
});

describe("confirmedDeletionsOf", () => {
  // A relationship made many-to-many keeps its name but its column goes, with every value in it:
  // the preview lists it as changed and destructive, and the Save confirms its count too. A change
  // that keeps the field's values confirms none.
  it("reads the count of a changed field that loses its values, and of no other", () => {
    expect(
      confirmedDeletionsOf({
        changes: {
          added: [],
          removed: [],
          changed: [
            {
              name: "author",
              from: "relationship",
              to: "relationship",
              rowCount: 2,
              classification: "destructive",
              reason: "type_changed",
            },
            {
              name: "title",
              from: "text",
              to: "text",
              rowCount: 5,
              classification: "safe",
              reason: "constraint_changed",
            },
          ],
          unchanged: [],
        },
      })
    ).toEqual([{ field: "author", count: 2 }]);
  });

  it("reads each removed field's count from the reviewed preview, an empty one included", () => {
    expect(
      confirmedDeletionsOf({
        changes: {
          added: [],
          removed: [
            { name: "note", type: "text", rowCount: 3, classification: "x" },
            { name: "empty", type: "text", rowCount: 0, classification: "x" },
          ],
          changed: [],
          unchanged: [],
        },
      })
    ).toEqual([
      { field: "note", count: 3 },
      { field: "empty", count: 0 },
    ]);
  });
});
