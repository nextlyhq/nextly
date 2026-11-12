/**
 * Bringing review state into line with the configuration's workflows, as `nextly migrate` does it
 * on a deploy.
 *
 * A development start does this at boot. A production start reads nothing of the schema, so the
 * deploy step does it instead, after its migrations: review state recorded under an earlier
 * configuration follows the workflows (a detached collection's removed, renamed and mapped stages
 * followed), and approvals given under an earlier definition are withdrawn unless it keeps them.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/follow-workflows
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import { withdrawApprovalsUnderEarlierDefinitions } from "../../domains/workflows/approval-follows-content";
import { followWorkflowDefinitions } from "../../domains/workflows/definition-sweep";
import { buildWorkflowRegistry } from "../../domains/workflows/registry";

import { installStrandedRunResolver } from "./workflow-stranded";

/**
 * Runs both passes on `adapter`, for the workflows `config` declares, through the tables the
 * attached collections and Singles keep, registered here since a command has no boot to have
 * registered them.
 */
export async function followWorkflowsAfterMigrate(
  config: SanitizedNextlyConfig,
  configPath: string | null,
  adapter: DrizzleAdapter
): Promise<void> {
  const registry = await buildWorkflowRegistry(config, configPath, {
    components: config.fieldGroups ?? [],
    readRegistry: false,
  });
  if (registry.size === 0) return;
  await installStrandedRunResolver(adapter, registry.values());
  await followWorkflowDefinitions(adapter, registry.values());
  await withdrawApprovalsUnderEarlierDefinitions(adapter, registry.values());
}
