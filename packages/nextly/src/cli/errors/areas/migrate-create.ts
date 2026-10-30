/**
 * Codes `nextly migrate:create` raises itself.
 *
 * @module cli/errors/areas/migrate-create
 */

import type { NextlyError } from "../../../errors/nextly-error";
import { CliError, type CliErrorParts } from "../cli-error";
import { defineCodes } from "../define";
import { sentences } from "../messages";

/**
 * A refusal in its own words: its first sentence is what happened, the next `why` sentences the
 * cause, and the rest what to do.
 */
function refusal(error: NextlyError, why: number): CliErrorParts {
  const parts = sentences(error.publicMessage);
  return {
    what: parts[0] ?? error.publicMessage,
    why: parts.slice(1, 1 + why).join(" "),
    next: parts.slice(1 + why).join(" "),
  };
}

/** A mapping from `migrate:create`'s own `INVALID_INPUT` with `reason`. */
const refused = (reason: string, why: number) => [
  {
    code: "INVALID_INPUT",
    reason,
    describe: (error: NextlyError) => refusal(error, why),
  },
];

export const MIGRATE_CREATE_CODES = defineCodes({
  MIGRATION_NAME_REQUIRED: {
    cause:
      "`nextly migrate:create` was given no name for a migration that is not blank.",
  },
  NO_TRANSACTION_NEEDS_BLANK: {
    cause:
      "`--no-transaction` was given to `nextly migrate:create` without `--blank` or `--plugin`.",
    from: refused("no-transaction-not-blank", 1),
  },
  PLUGIN_EXTENDS_OUTSIDE_ITS_SCHEMA: {
    cause:
      "A plugin's `schema.extend` hook extends an entity that is not in the schema its migration module is compiled from.",
    from: refused("plugin-extend-target-outside", 1),
  },
  PLUGIN_ENTRY_EXPORTS_SEVERAL: {
    cause:
      "The file given to `--plugin` exports more than one plugin, so it is not clear which to generate for.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "plugin-entry-exports-several",
        describe: error => ({
          ...refusal(error, 0),
          why: "`nextly migrate:create --plugin` generates the migrations of one plugin at a time.",
        }),
      },
    ],
  },
  PLUGIN_ENTRY_UNNAMED: {
    cause:
      "The file given to `--plugin` exports no plugin definition with a name.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "plugin-entry-unnamed",
        describe: error => ({
          what: error.publicMessage,
          why: "A plugin's migrations are recorded under its name.",
          next: "Point `--plugin` at the file that exports the plugin, made with `definePlugin` and given a `name`.",
        }),
      },
    ],
  },
  PLUGIN_SCHEMA_VERSION_MISSING: {
    cause:
      "The plugin given to `--plugin` declares no `schemaVersion`, which its migrations are numbered by.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "plugin-schema-version-missing",
        describe: error => ({
          ...refusal(error, 1),
          next: "Add `schemaVersion: 1` to the plugin's definition, then run the command again.",
        }),
      },
    ],
  },
  PLUGIN_MIGRATIONS_BARREL_UNREADABLE: {
    cause:
      "The plugin's existing migrations barrel could not be loaded, so `nextly migrate:create` stopped rather than rewrite it.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "plugin-migrations-barrel-unreadable",
        describe: error => {
          const barrel = error.logContext?.barrel;
          const detail = error.logContext?.detail;
          return {
            what: `The plugin's migrations barrel${typeof barrel === "string" ? ` at \`${barrel}\`` : ""} could not be loaded.`,
            why:
              typeof detail === "string"
                ? `${detail} Generating anyway would rewrite the barrel and orphan the modules it lists.`
                : "Generating anyway would rewrite the barrel and orphan the modules it lists.",
            next: "Fix the barrel, or the module it imports, then run the command again.",
          };
        },
      },
    ],
  },
  MIGRATION_CREATE_CANCELLED: {
    cause:
      "A prompt of `nextly migrate:create` was cancelled, so it wrote no migration.",
  },
});

/** A migration that is not `--blank` needs a name, positional or `--name`. */
export function migrationNameRequired(): CliError {
  return new CliError("MIGRATION_NAME_REQUIRED", {
    what: "`nextly migrate:create` needs a name for the migration.",
    why: "Only a `--blank` migration may be created without a name.",
    next: "Name it, as in `nextly migrate:create add_excerpt` or `--name=add_excerpt`, or pass `--blank` for an empty migration.",
  });
}

/** The operator closed a prompt; the prompt printed its own cancel line first. */
export function migrationCreateCancelled(): CliError {
  return new CliError("MIGRATION_CREATE_CANCELLED", {
    what: "`nextly migrate:create` was cancelled, and wrote no migration.",
    why: "A prompt was closed before it was answered.",
    next: "Run `nextly migrate:create` again when you are ready to answer its prompts.",
  });
}
