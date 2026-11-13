/**
 * The exported `nextly` convenience object is a hand-listed delegate to the `Nextly` class: every
 * method an instance has must be reachable through it, or `import { nextly } from "nextly"` lacks
 * what the class and its documentation offer. A method added to the class fails this until it is
 * delegated too.
 */
import { describe, expect, it } from "vitest";

import { Nextly, nextly } from "../nextly";

/** The class's own methods, by name: what an instance can be asked to do. */
function classMethods(): string[] {
  return Object.getOwnPropertyNames(Nextly.prototype).filter(name => {
    if (name === "constructor") return false;
    const descriptor = Object.getOwnPropertyDescriptor(Nextly.prototype, name);
    return typeof descriptor?.value === "function";
  });
}

describe("the exported nextly delegate", () => {
  it("offers every method the class has", () => {
    const methods = classMethods();
    // The class's methods were read: an empty list would pass as a clean one.
    expect(methods).toContain("publish");

    const delegated = new Set(
      Object.entries(nextly)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name)
    );
    expect(methods.filter(name => !delegated.has(name))).toEqual([]);
  });
});
