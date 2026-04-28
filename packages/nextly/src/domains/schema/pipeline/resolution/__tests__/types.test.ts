// Unit tests for F5+F6 resolution + classifier event types.
import { describe, it, expect } from "vitest";

import { formatEventId, parseEventId } from "../types.js";

describe("eventId helpers", () => {
  it("formats not-null event id from kind, table, column", () => {
    const id = formatEventId("add_not_null_with_nulls", "dc_users", "email");
    expect(id).toBe("add_not_null_with_nulls:dc_users.email");
  });

  it("formats type-change event id", () => {
    const id = formatEventId("type_change", "dc_posts", "age");
    expect(id).toBe("type_change:dc_posts.age");
  });

  it("parses an event id back into its parts", () => {
    expect(parseEventId("add_not_null_with_nulls:dc_users.email")).toEqual({
      kind: "add_not_null_with_nulls",
      table: "dc_users",
      column: "email",
    });
  });

  it("throws on malformed event id", () => {
    expect(() => parseEventId("garbage")).toThrow(/malformed/i);
  });
});
