/**
 * The admin keeps ONE client-safe copy of core's system-resource list, and four
 * views derive from it: the role matrix puts a system resource in the Settings
 * tab rather than among collections, the capability builder maps it to a
 * dedicated flag rather than per-collection access, and the permissions page
 * both classifies and orders by it.
 *
 * A resource that core treats as a system resource but the admin does not is
 * silently miscategorised — granted from the wrong section of the role editor,
 * shown under the wrong bucket, surfaced as collection access in the
 * navigation. Nothing throws; it just shows the wrong thing, which is why this
 * drifted unnoticed until a new resource was added.
 *
 * WHAT THESE CASES NOW PROVE, and what they no longer do. There were four
 * hand-kept copies and this test held each against core. Three of them now
 * derive from the fourth, so those three assertions are tautological — kept
 * deliberately, because they are cheap and they fail loudly if somebody
 * reintroduces a literal list at one of those sites. The load-bearing
 * comparison is ADMIN against CORE: the divergence that actually happens is a
 * resource added in `packages/nextly` and never mirrored here, and the change
 * that causes it does not touch this package at all.
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
