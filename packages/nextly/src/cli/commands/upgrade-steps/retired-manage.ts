/**
 * Upgrade step: convert roles holding a retired `manage-` permission.
 *
 * A role an earlier release gave `manage-<resource>` on media, settings,
 * email providers or email templates is given the plain read, create, update
 * and delete there, and the `manage-` permission is taken off, each role under
 * the lock its other writers take. A role holding none is left alone, so a
 * second run finds nothing to do. It reports how many roles it converted,
 * never which.
 *
 * The step itself is declared in `./index.ts`, which loads this module only
 * when the upgrade asks the step: what it reads and writes reaches the role
 * services, which nothing else the CLI loads needs.
 *
 * @module cli/commands/upgrade-steps/retired-manage
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { rolesHoldingRetiredManage } from "../../../domains/auth/retired-manage";
import { RolePermissionService } from "../../../domains/auth/services/role-permission-service";
import { consoleLogger } from "../../../services/shared";
import type { UpgradeStepContext } from "../upgrade-step";

const adapterOf = (context: UpgradeStepContext) =>
  context.adapter as unknown as DrizzleAdapter;

/** How many roles hold a retired `manage-` permission: the step's count. */
export async function rolesToConvert(
  context: UpgradeStepContext
): Promise<number> {
  return (await rolesHoldingRetiredManage(adapterOf(context))).length;
}

/** Convert each of those roles, and say how many it converted. */
export async function convertRoles(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = adapterOf(context);
  const roles = new RolePermissionService(adapter, consoleLogger);
  let converted = 0;
  let kept = 0;
  for (const role of await rolesHoldingRetiredManage(adapter)) {
    if (await roles.convertRetiredManage(role.id)) converted++;
    else kept++;
  }
  // A role whose resource lacks one of the plain four keeps its `manage-`
  // permission rather than lose access, so the upgrade is not done for it:
  // said here with the remedy, never counted as converted.
  if (kept > 0) {
    context.warn(
      `${kept} role(s) still hold a retired manage permission: a plain read, create, update or delete permission it stands for is missing. Start Nextly once so it seeds them, then run \`nextly upgrade\` again.`
    );
  }
  return converted;
}
