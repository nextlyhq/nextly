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

  it("throws when kind is not in the whitelisted set (adversarial input safety)", () => {
    // Critical for PR 6's browser SSE boundary which deserializes ids from
    // potentially-untrusted client requests.
    expect(() => parseEventId("not_a_real_kind:dc_users.email")).toThrow(
      /unknown kind/i
    );
  });

  it("parses schema-qualified table names (e.g. public.dc_users)", () => {
    // Drizzle/Postgres allow schema-qualified table names. Column part is
    // always a single identifier so we split off the right end.
    expect(parseEventId("type_change:public.dc_users.email")).toEqual({
      kind: "type_change",
      table: "public.dc_users",
      column: "email",
    });
  });

  it("round-trips for all event kinds", () => {
    const cases: Array<
      [
        Parameters<typeof formatEventId>[0],
        Parameters<typeof formatEventId>[1],
        Parameters<typeof formatEventId>[2],
      ]
    > = [
      ["add_not_null_with_nulls", "dc_users", "email"],
      ["add_required_field_no_default", "dc_posts", "summary"],
      ["type_change", "dc_users", "age"],
    ];
    for (const [kind, table, column] of cases) {
      const id = formatEventId(kind, table, column);
      expect(parseEventId(id)).toEqual({ kind, table, column });
    }
  });

  it("throws when table or column is empty", () => {
    expect(() => parseEventId("type_change:.email")).toThrow(/malformed/i);
    expect(() => parseEventId("type_change:dc_users.")).toThrow(/malformed/i);
  });
});
