/**
 * The admin's copy of the resources whose `manage` permission stands for read,
 * create, update and delete, held to core's.
 *
 * The roles screen reads `manage` on those as Can edit, and anywhere else as a
 * permission of its own. A resource core bridges and the admin does not would
 * show a role still holding the legacy grant as having no access; one the
 * admin bridges and core does not would show, and let a level change remove, a
 * real permission. Core decides it through `manageCounts`, asked here over
 * every system resource.
 *
 * Imports core's source directly, as the system-resource parity test does: a
 * `nextly/*` subpath resolves to built output and would need a build.
 */
import { describe, expect, it } from "vitest";

import { manageCounts } from "../../../../nextly/src/auth/access/actor";
import { SYSTEM_RESOURCES } from "../../../../nextly/src/schemas/_zod/rbac";

import { MANAGE_BRIDGE_RESOURCES } from "./levels";

describe("the resources whose manage stands for edit", () => {
  it("are exactly the ones core counts manage on", () => {
    const core = SYSTEM_RESOURCES.filter(resource =>
      manageCounts("update", resource)
    ).sort();
    expect([...MANAGE_BRIDGE_RESOURCES].sort()).toEqual(core);
  });
});
