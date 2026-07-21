/**
 * The admin keeps its own copies of the system-resource list, and they decide
 * which bucket a permission falls into: the role matrix puts a system resource
 * in the Settings tab rather than among collections, and the capability builder
 * maps it to a dedicated flag rather than per-collection access.
 *
 * A resource that core treats as a system resource but the admin does not is
 * silently miscategorised — granted from the wrong section of the role editor,
 * and surfaced as collection access in the navigation. Nothing fails; it just
 * shows the wrong thing.
 *
 * The copies exist because these hooks run in the browser and importing core's
 * schema barrel into the client bundle would pull server code with it. The
 * import here is fine: this runs in Node.
 */
import { SYSTEM_RESOURCES } from "nextly/schemas";
import { describe, it, expect } from "vitest";

import { SYSTEM_RESOURCES as CAPABILITY_RESOURCES } from "../useCurrentUserPermissions";
import { SYSTEM_RESOURCE_SLUGS } from "../useRoleForm";

describe("admin system-resource lists match core", () => {
  const expected = [...SYSTEM_RESOURCES].sort();

  it("the role matrix covers every system resource", () => {
    expect([...SYSTEM_RESOURCE_SLUGS].sort()).toEqual(expected);
  });

  it("the capability builder covers every system resource", () => {
    expect([...CAPABILITY_RESOURCES].sort()).toEqual(expected);
  });
});
