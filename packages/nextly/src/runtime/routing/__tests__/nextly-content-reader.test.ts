/**
 * Compile-time guard: the public `Nextly` instance (what `await getNextly(config)`
 * returns) must satisfy the structural `NextlyContentReader` the routing helpers
 * accept — otherwise the documented explicit-instance path would not type-check.
 */
import { describe, expect, it } from "vitest";

import type { Nextly as PublicNextly } from "../../../init";
import type { NextlyContentReader } from "../resolve-content";

describe("NextlyContentReader", () => {
  it("accepts the public Nextly instance type", () => {
    const assign = (n: PublicNextly): NextlyContentReader => n;
    expect(typeof assign).toBe("function");
  });
});
