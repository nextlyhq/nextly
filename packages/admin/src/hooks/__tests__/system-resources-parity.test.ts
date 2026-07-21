/**
 * The admin keeps four copies of core's system-resource list, and each decides
 * how a permission is presented: the role matrix puts a system resource in the
 * Settings tab rather than among collections, the capability builder maps it to
 * a dedicated flag rather than per-collection access, and the permissions page
 * both classifies and orders by its own pair of lists.
 *
 * A resource that core treats as a system resource but a copy does not is
 * silently miscategorised — granted from the wrong section of the role editor,
 * shown under the wrong bucket, surfaced as collection access in the
 * navigation. Nothing throws; it just shows the wrong thing, which is why this
 * drifted unnoticed until a new resource was added.
 *
 * The copies exist because these modules run in the browser and pulling core's
 * schema barrel into the client bundle would bring server code with it. This
 * test imports the source module directly rather than through the `nextly`
 * package: the admin tsconfig maps only the bare specifier, so a `nextly/*`
 * subpath resolves to built output and would make this test require a build.
 */
import { describe, it, expect } from "vitest";

import { SYSTEM_RESOURCES } from "../../../../nextly/src/schemas/_zod/rbac";
import {
  SYSTEM_ORDER,
  SYSTEM_RESOURCES as PAGE_RESOURCES,
} from "../../pages/dashboard/settings/permissions/system-resources";
import { SYSTEM_RESOURCES as CAPABILITY_RESOURCES } from "../useCurrentUserPermissions";
import { SYSTEM_RESOURCE_SLUGS } from "../useRoleForm";

const expected = [...SYSTEM_RESOURCES].sort();

describe("admin system-resource lists match core", () => {
  it.each([
    ["the role matrix", SYSTEM_RESOURCE_SLUGS],
    ["the capability builder", CAPABILITY_RESOURCES],
    ["the permissions page", PAGE_RESOURCES],
    ["the permissions page display order", SYSTEM_ORDER],
  ])("%s covers every system resource", (_label, copy) => {
    expect([...copy].sort()).toEqual(expected);
  });
});
