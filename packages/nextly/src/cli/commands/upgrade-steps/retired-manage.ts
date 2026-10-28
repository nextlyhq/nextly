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
 * @module cli/commands/upgrade-steps/retired-manage
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { rolesHoldingRetiredManage } from "../../../domains/auth/retired-manage";
import { consoleLogger } from "../../../services/shared";
import type { UpgradeStep, UpgradeStepContext } from "../upgrade-step";

const adapterOf = (context: UpgradeStepContext) =>
  context.adapter as unknown as DrizzleAdapter;

export const retiredManageStep: UpgradeStep = {
  title: "give roles holding a retired manage permission the plain permissions",
  pending: async context =>
    (await rolesHoldingRetiredManage(adapterOf(context))).length,
  run: async context => {
    // Loaded when the step runs rather than with the upgrade command: the
    // role writers reach the service graph, which nothing else in the
    // command needs, and every test of the command would load it too.
    const { RolePermissionService } = await import(
      "../../../domains/auth/services/role-permission-service"
    );
    const adapter = adapterOf(context);
    const roles = new RolePermissionService(adapter, consoleLogger);
    let converted = 0;
    for (const role of await rolesHoldingRetiredManage(adapter)) {
      if (await roles.convertRetiredManage(role.id)) converted++;
    }
    return converted;
  },
};
