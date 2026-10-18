/**
 * The module-level `nextly.releases` facade offers every method the releases
 * namespace has.
 *
 * The facade lists its delegates by name, and a method added to the namespace
 * without one is reachable from an instance and missing from `nextly`, with
 * nothing at runtime to say so until a caller trips over it.
 */
import { describe, expect, it } from "vitest";

import { createReleasesNamespace } from "../namespaces/releases";
import type { NextlyContext } from "../namespaces/context";
import { nextly } from "../nextly";

describe("the nextly.releases facade", () => {
  it("delegates every method of the releases namespace", () => {
    const namespace = createReleasesNamespace({} as NextlyContext);
    expect(Object.keys(nextly.releases).sort()).toEqual(
      Object.keys(namespace).sort()
    );
  });
});
