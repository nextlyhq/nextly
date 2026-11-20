/**
 * A project whose migration history keeps its field groups on the legacy names
 * (`dynamic_components`, `comp_<slug>`, `_component_type`), as every history an earlier release
 * wrote does. A new project's history starts on the current names, so a test of how an existing
 * site moves, or of legacy storage itself, writes its first migration here: `migrate:create`'s
 * own steps (`appMigrationInputs`, then `generateMigration`), told the legacy names.
 *
 * `nextly migrate` then sets an empty database up on those names, as it would for such a project.
 *
 * @module __tests__/helpers/legacy-field-group-history
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { appMigrationInputs } from "../../domains/schema/migrate-create/app-migration-inputs";
import { declaredPermissionsOf } from "../../domains/schema/migrate-create/declared-permissions";
import { generateMigration } from "../../domains/schema/migrate-create/generate";

/** Writes the project's next migration, named `name`, with its field groups on the legacy names. */
export async function writeLegacyFieldGroupMigration(args: {
  config: Parameters<typeof appMigrationInputs>[0]["config"] &
    Parameters<typeof declaredPermissionsOf>[0];
  projectRoot: string;
  /** Absolute path to the project's migrations folder. */
  migrationsDir: string;
  dialect: SupportedDialect;
  name: string;
}): Promise<void> {
  const quiet = { warn: () => {}, error: () => {} };
  const inputs = await appMigrationInputs({
    config: args.config,
    projectRoot: args.projectRoot,
    migrationsDir: args.migrationsDir,
    dialect: args.dialect,
    logger: quiet,
    fieldGroupNaming: "legacy",
  });
  await generateMigration({
    name: args.name,
    dialect: args.dialect,
    migrationsDir: args.migrationsDir,
    collections: inputs.collections,
    singles: inputs.singles,
    components: inputs.components,
    previous: inputs.latest,
    metadataUpserts: inputs.metadataUpserts,
    previousMetadataUpserts: inputs.previousMetadataUpserts,
    appStream: inputs.appStream,
    permissions: declaredPermissionsOf(args.config, {
      collections: inputs.collections,
      singles: inputs.singles,
    }),
    fieldGroupNaming: "legacy",
    nonInteractive: true,
  });
}
