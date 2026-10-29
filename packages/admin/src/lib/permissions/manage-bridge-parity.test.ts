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

import { manageCounts } from "../../../../nextly/src/auth/access/manage-bridge";
import { SYSTEM_RESOURCES } from "../../../../nextly/src/schemas/_zod/rbac";

import { holdsPermission } from "./holds-permission";
import {
  MANAGE_BRIDGE_RESOURCES,
  levelOf,
  manageCountsFor,
  standardActions,
} from "./levels";

/** Every access operation, so an action core starts counting is seen here. */
const OPERATIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
] as const;

describe("the resources whose manage stands for edit", () => {
  it.each([...SYSTEM_RESOURCES])(
    "counts manage on %s as the same actions core does",
    resource => {
      // What core lets `manage-<resource>` stand for, action by action.
      const core = OPERATIONS.filter(action => manageCounts(action, resource));
      // What the admin reads it as: the actions of the level it shows for a
      // row holding manage alone, read over the actions that level decides.
      const level = levelOf("system", ["manage"], resource);
      const admin =
        level === "edit"
          ? OPERATIONS.filter(action =>
              standardActions("system", resource).has(action)
            )
          : [];
      expect(admin).toEqual(core);
      expect(MANAGE_BRIDGE_RESOURCES.has(resource)).toBe(core.length > 0);
    }
  );
});

describe("the permission check's manage bridge", () => {
  it.each([...SYSTEM_RESOURCES])(
    "counts manage-%s as each action core counts it for, and no other",
    resource => {
      const held = new Set([`manage-${resource}`]);
      for (const action of [...OPERATIONS, "manage"]) {
        const counted = manageCounts(action, resource);
        expect(manageCountsFor(action, resource), action).toBe(counted);
        // Holding manage alone holds an action exactly where it counts, or
        // where the action asked is manage itself.
        expect(holdsPermission(held, `${action}-${resource}`), action).toBe(
          counted || action === "manage"
        );
      }
    }
  );
});
