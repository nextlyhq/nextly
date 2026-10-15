/**
 * Which secret generation the database limit store's entries are written
 * under, judged as the install's other secret-derived values judge it.
 */
import { describe, expect, it } from "vitest";

import { limitStoreGeneration } from "../store-generation";

describe("the limit store's generation", () => {
  it("names an empty secret as a keyed generation of its own, apart from no secret at all", () => {
    // `shared/lib/secret-generations` reads only `undefined` as the unkeyed
    // generation; an empty string is a secret like any other.
    expect(limitStoreGeneration("")).not.toBe(limitStoreGeneration(undefined));
    expect(limitStoreGeneration("")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("names no secret as the unkeyed generation, and two secrets apart", () => {
    expect(limitStoreGeneration(undefined)).toBe("unkeyed");
    expect(limitStoreGeneration("one")).not.toBe(limitStoreGeneration("two"));
  });
});
