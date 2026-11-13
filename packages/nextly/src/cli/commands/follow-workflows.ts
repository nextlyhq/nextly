/**
 * Bringing review state into line with the configuration's workflows, as `nextly migrate` does it
 * on a deploy.
 *
 * A development start does this at boot, and so does a production start that applies its own
 * migrations (`db.runMigrationsOnBoot`). Any other production start reads nothing of the schema,
 * so the deploy step does it instead, after its migrations: review state recorded under an
 * earlier configuration follows the workflows (a detached collection's removed, renamed and
 * mapped stages followed), and approvals given under an earlier definition are withdrawn unless
 * it keeps them.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/follow-workflows
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import { publishRecordingPoliciesForCommand } from "../../di/register";
import {
  publishDeclaredEntities,
  restoreDeclaredEntities,
} from "../../domains/dynamic-collections/services/removed-from-code-writes";
import { withdrawApprovalsUnderEarlierDefinitions } from "../../domains/workflows/approval-follows-content";
import { followWorkflowDefinitions } from "../../domains/workflows/definition-sweep";
import { buildWorkflowRegistry } from "../../domains/workflows/registry";
import { readReviewStateScopes } from "../../domains/workflows/review-state-repository";
import { REVIEW_STATES_TABLE } from "../../schemas/review-states";
import type { Logger } from "../../services/shared";
import { withCommandServicesLent } from "../utils/lend-command-services";

import { installEntityTablesResolver } from "./workflow-stranded";

/**
 * Runs both passes on `adapter` for the workflows `config` declares, with none declared too, since
 * removing the last workflow detaches every document it held. The workflows are judged as boot
 * judges them, the configuration's components as written and any other (one made in the admin)
 * from the registry, on the services lent for the command. The tables written through are those
 * of every entity attached, and of every entity stored review state names, a detached one
 * included: registered here, since a command has no boot to have registered them. The entities
 * the configuration declares are published while it runs, as boot publishes them, so an entity
 * removed from code keeps what it holds until its teardown.
 *
 * `config` is null where no configuration file was found: nothing then says which workflows there
 * are, and an empty set would detach every document, so nothing is done.
 */
export async function followWorkflowsAfterMigrate(
  config: SanitizedNextlyConfig | null,
  configPath: string | null,
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<void> {
  if (config === null) {
    logger.warn(
      "No configuration file was found, so review state was not brought into line with the workflows."
    );
    return;
  }
  const declared = publishDeclaredEntities(config);
  try {
    await followWorkflowsOn(config, configPath, adapter, logger);
  } finally {
    restoreDeclaredEntities(declared);
  }
}

/** Both passes, for the workflows `config` declares; see {@link followWorkflowsAfterMigrate}. */
async function followWorkflowsOn(
  config: SanitizedNextlyConfig,
  configPath: string | null,
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<void> {
  await withCommandServicesLent(adapter, logger, async () => {
    // A part moved here records its `workflow.stage_changed` event under the same switches a
    // request's does, so an entity with `webhooks: false` records none.
    await publishRecordingPoliciesForCommand(adapter, config);
    const registry = await buildWorkflowRegistry(config, configPath, {
      components: config.fieldGroups ?? [],
    });
    const workflows = [...registry.values()];
    const stored = (await adapter.tableExists(REVIEW_STATES_TABLE))
      ? await readReviewStateScopes(adapter)
      : { collections: [], singles: [] };
    await installEntityTablesResolver(adapter, {
      collections: [
        ...workflows.flatMap(each => each.collections),
        ...stored.collections,
      ],
      singles: [...workflows.flatMap(each => each.singles), ...stored.singles],
    });
    await followWorkflowDefinitions(adapter, workflows);
    await withdrawApprovalsUnderEarlierDefinitions(adapter, workflows);
  });
}
