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
  RECORD_SNAPSHOT_NEEDS_APP_MIGRATION: {
    cause:
      "`--record-snapshot` was given to `nextly migrate:create` with `--blank` or `--plugin`, which write no snapshot of the app.",
  },
  RECORD_SNAPSHOT_STORAGE_MISSING: {
    cause:
      "`nextly migrate:create --record-snapshot` would record translated fields that the database has no translations table or column for.",
    from: [
      {
        code: "VALIDATION_ERROR",
        reason: "record-snapshot-storage-missing",
        describe: error => {
          // Each as `collection "posts" has no column for "body" in dc_posts_locales`.
          const missing = error.logContext?.missing;
          return {
            what: Array.isArray(missing)
              ? `\`--record-snapshot\` found translated fields the database holds no storage for: ${missing.join("; ")}.`
              : error.publicMessage,
            why: "It records which fields are translated as the database holds them, so that no later migration is planned over a translations table that is not there. Nothing was written.",
            next: "Run it against a database that has applied every migration, with the config as it was at the last migration.",
          };
        },
      },
    ],
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

/** `--record-snapshot` writes the app's snapshot, which a blank migration and a plugin module have none of. */
export function recordSnapshotNeedsAppMigration(): CliError {
  return new CliError("RECORD_SNAPSHOT_NEEDS_APP_MIGRATION", {
    what: "`--record-snapshot` can't be combined with `--blank` or `--plugin`.",
    why: "It writes the app's migration and the snapshot that records which fields are translated, and a blank migration or a plugin module has no such snapshot.",
    next: "Run `nextly migrate:create --record-snapshot` on its own.",
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
