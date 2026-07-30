/**
 * A JSON column stores a JSON document, and `true` and `42` are documents just
 * as much as `{}` is. Encoding only objects left a scalar to reach the driver
 * as its own type — on SQLite, where the column is plain text, a boolean bound
 * to a text column does not read back as JSON `true`.
 */
import { describe, expect, it } from "vitest";

import { toJsonColumnValue } from "../json-column-value";

describe("toJsonColumnValue", () => {
  it("encodes a scalar JSON document", () => {
    expect(toJsonColumnValue(true).value).toBe("true");
    expect(toJsonColumnValue(42).value).toBe("42");
  });

  it("encodes objects and arrays", () => {
    expect(toJsonColumnValue({ a: 1 }).value).toBe('{"a":1}');
    expect(toJsonColumnValue([1, 2]).value).toBe("[1,2]");
  });

  it("leaves an already-encoded string alone", () => {
    // Re-encoding would wrap it in quotes and change what is stored.
    expect(toJsonColumnValue('{"a":1}').value).toBe('{"a":1}');
    expect(toJsonColumnValue('{"a":1}').invalidJsonString).toBe(false);
  });

  it("reports a string that is not JSON, without altering it", () => {
    const result = toJsonColumnValue("not json");

    expect(result.value).toBe("not json");
    expect(result.invalidJsonString).toBe(true);
  });

  it("passes null and undefined through", () => {
    // The column is nullable and the callers skip these, so encoding them
    // would write the string "null" where a real SQL NULL belongs.
    expect(toJsonColumnValue(null).value).toBeNull();
    expect(toJsonColumnValue(undefined).value).toBeUndefined();
  });
});
