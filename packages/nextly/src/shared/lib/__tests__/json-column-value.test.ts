/**
 * A JSON column stores a JSON document, and `true` and `42` are documents just
 * as much as `{}` is. Encoding only objects left a scalar to reach the driver
 * as its own type — on SQLite, where the column is plain text, a boolean bound
 * to a text column does not read back as JSON `true`.
 *
 * A string is the ambiguous input: it may be a document an earlier step
 * encoded, or the logical string being stored. One half of that is not
 * ambiguous at all — a string that does not parse cannot be an encoded
 * document, so writing it raw is wrong under either meaning.
 */
import { describe, expect, it } from "vitest";

import { toJsonColumnValue } from "../json-column-value";

describe("toJsonColumnValue", () => {
  it("encodes a scalar JSON document", () => {
    expect(toJsonColumnValue(true)).toBe("true");
    expect(toJsonColumnValue(42)).toBe("42");
  });

  it("encodes objects and arrays", () => {
    expect(toJsonColumnValue({ a: 1 })).toBe('{"a":1}');
    expect(toJsonColumnValue([1, 2])).toBe("[1,2]");
  });

  it("leaves an already-encoded string alone", () => {
    // Re-encoding would wrap it in quotes and change what is stored.
    expect(toJsonColumnValue('{"a":1}')).toBe('{"a":1}');
  });

  it("encodes a string that cannot be an encoded document", () => {
    // Written raw it puts bare text where the column holds JSON, which
    // Postgres and MySQL reject outright. Nothing could have produced it as an
    // encoded document, so there is no double-encoding to fear.
    expect(toJsonColumnValue("not json")).toBe('"not json"');
  });

  it("round-trips a non-parsing string through a JSON parse", () => {
    // What the read side does with the stored text, so the value a caller gets
    // back is the string they wrote rather than a parse failure.
    const stored = toJsonColumnValue("hello");

    expect(JSON.parse(stored as string)).toBe("hello");
  });

  it("passes null and undefined through", () => {
    // The column is nullable and the callers skip these, so encoding them
    // would write the string "null" where a real SQL NULL belongs.
    expect(toJsonColumnValue(null)).toBeNull();
    expect(toJsonColumnValue(undefined)).toBeUndefined();
  });
});
