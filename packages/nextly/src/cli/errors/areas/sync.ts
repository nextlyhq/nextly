/**
 * Codes for `db:sync` and its promote and demote steps, and for the commands that move stored
 * content between shapes: `migrate:fresh`, `migrate:field-groups` and `i18n:restore`.
 *
 * Most are raised by the commands themselves, through the helpers below. The field-group
 * migration's refusals are mappings: its engine throws them, and both `migrate:field-groups` and
 * `db:sync` end on them.
 *
 * @module cli/errors/areas/sync
 */

import { REFUSAL_KIND_KEY } from "../../../domains/field-groups/migration/refusal-kind";
import {
  chooseRestoreEntity,
  type ResolvedEntityTable,
} from "../../../domains/i18n/migration/resolve-entity-table";
import type { NextlyError } from "../../../errors/nextly-error";
import { CliError } from "../cli-error";
import { defineCodes } from "../define";

/** The field-group migration command for a direction, as the user types it. */
function fieldGroupCommand(error: NextlyError): string {
  return error.logContext?.direction === "down"
    ? "nextly migrate:field-groups --down --apply --backup-confirmed"
    : "nextly migrate:field-groups --apply --backup-confirmed";
}

export const SYNC_CODES = defineCodes({
  LOCALIZATION_NOT_PROVISIONED: {
    cause:
      "`db:sync` could not create the translation tables of a localized entity, so its translations cannot be written or read.",
    from: [
      {
        code: "CONFLICT",
        reason: "localization-not-provisioned",
        describe: error => {
          const entities = Array.isArray(error.logContext?.entities)
            ? (error.logContext.entities as unknown[]).map(String)
            : [];
          return {
            what: `Localization could not be brought into step for ${entities.map(e => `\`${e}\``).join(", ") || "some entities"}.`,
            why: "Their translation tables could not be created, so their translations are either unwritable or unreadable until they are.",
            next: "Run `nextly db:sync --verbose` to see the statement that failed, fix its cause, then run it again.",
          };
        },
      },
    ],
  },
  PROMOTE_COLLECTION_NOT_FOUND: {
    cause:
      "`db:sync --promote` names a collection the Schema Builder has no record of.",
  },
  DEMOTE_COLLECTION_NOT_FOUND: {
    cause:
      "`db:sync --demote` names a collection that `nextly.config.ts` does not define.",
  },
  I18N_RESTORE_COLLECTION_REQUIRED: {
    cause:
      "`i18n:restore` was run without `--collection`, so it has no entity to restore.",
  },
  I18N_RESTORE_KIND_INVALID: {
    cause:
      "`i18n:restore --kind` is not `collection`, `single` or `field-group`.",
  },
  I18N_RESTORE_ENTITY_NOT_FOUND: {
    cause:
      "`i18n:restore --collection` names no collection, single or field group in the configuration or `ui-schema.json`.",
  },
  I18N_RESTORE_ENTITY_AMBIGUOUS: {
    cause:
      "`i18n:restore --collection` names more than one kind of entity, and `--kind` does not say which.",
  },
  FIELD_GROUP_BACKUP_NOT_CONFIRMED: {
    cause:
      "`migrate:field-groups --apply` was run without `--backup-confirmed`, so it changed nothing.",
    from: [
      {
        code: "SERVICE_UNAVAILABLE",
        reason: "no backup acknowledgement",
        describe: error => ({
          what: "`nextly migrate:field-groups --apply` did not run: it needs `--backup-confirmed`.",
          why: "Applying renames field-group tables and rewrites stored rows, so it runs only once you confirm a restorable backup of the database exists.",
          next: `Take a backup of the database, then run \`${fieldGroupCommand(error)}\`.`,
        }),
      },
    ],
  },
  FIELD_GROUP_MIGRATION_IN_FLIGHT: {
    cause:
      "A field-group storage migration is part-way through on this database, so the command refused to change its schema.",
    from: [
      {
        code: "SERVICE_UNAVAILABLE",
        reason: "field group storage migration is in flight",
        describe: error => {
          const step = error.logContext?.step;
          return {
            what: "The command did not run: a field-group storage migration is in flight on this database.",
            why: `Mid-run, some field-group tables carry their old names and some their new ones${
              typeof step === "number" ? ` (it is at step ${step})` : ""
            }, a shape neither the old configuration nor the new one describes.`,
            next: `Let the running migration finish, or, if it stopped, resume it with \`${fieldGroupCommand(error)}\`; then run this command again.`,
          };
        },
      },
    ],
  },
  FIELD_GROUP_STORAGE_REFUSED: {
    cause:
      "The field-group storage on this database is in a shape the field-group migration will not proceed from.",
    from: [
      {
        // Every refusal the migration's reconciliation and boot guard raise carries its kind,
        // and its reason names the storage at fault.
        code: "SERVICE_UNAVAILABLE",
        when: error => error.logContext?.[REFUSAL_KIND_KEY] !== undefined,
        describe: error => {
          const reason = error.logContext?.reason;
          return {
            what: "The field-group storage migration refused to proceed.",
            why:
              typeof reason === "string" && reason.length > 0
                ? `${reason[0].toUpperCase()}${reason.slice(1)}.`
                : "The field-group tables are in a shape the migration does not recognise.",
            next: "Run the command again with `--verbose` to see the tables and rows involved, and check them before running anything that changes the schema.",
          };
        },
      },
    ],
  },
});

/** `db:sync --promote <slug>` for a slug the Schema Builder has no collection under. */
export function promoteCollectionNotFound(slug: string): CliError {
  return new CliError("PROMOTE_COLLECTION_NOT_FOUND", {
    what: `Collection '${slug}' not found in UI source (dynamic_collections).`,
    why: "`--promote` moves a collection built in the Schema Builder into code, and no collection with this slug was built there.",
    next: "Check the slug in the admin's Schema Builder. A collection already defined in `nextly.config.ts` is in code and needs no promotion.",
  });
}

/** `db:sync --demote <slug>` for a slug the configuration defines no collection under. */
export function demoteCollectionNotFound(slug: string): CliError {
  return new CliError("DEMOTE_COLLECTION_NOT_FOUND", {
    what: `Collection '${slug}' not found in nextly.config.ts collections.`,
    why: "`--demote` moves a collection defined in `nextly.config.ts` to the Schema Builder, and its `collections` array has none with this slug.",
    next: "Check the slug against the `collections` array in `nextly.config.ts`. A collection built in the Schema Builder is already there and needs no demotion.",
  });
}

/** `i18n:restore` run without the slug of what to restore. */
export function restoreCollectionRequired(): CliError {
  return new CliError("I18N_RESTORE_COLLECTION_REQUIRED", {
    what: "--collection <slug> is required.",
    why: "`nextly i18n:restore` brings back the archived translations of one entity, named by its slug.",
    next: "Run `nextly i18n:restore --collection <slug>` with the slug of the collection, single or field group to restore.",
  });
}

/** One entity of each kind, for asking the restore's own chooser whether a `--kind` is valid. */
const EVERY_KIND: readonly ResolvedEntityTable[] = (
  ["collection", "single", "fieldGroup"] as const
).map(kind => ({ tableName: "", companionTableName: "", kind }));

/**
 * The restore's refusal to choose an entity, under the code for its cause.
 *
 * `chooseRestoreEntity` answers with one sentence for each cause. Which cause it was is asked of
 * the chooser again rather than read from its wording: a `--kind` it cannot match against one
 * entity of every kind is not a kind at all, and otherwise no match at all is a slug not found.
 */
export function restoreEntityRefusal(args: {
  slug: string;
  kind: string | undefined;
  found: number;
  problem: string;
}): CliError {
  const { slug, kind, found, problem } = args;
  const looked = "Looked in your config and ui-schema.json.";
  if (
    kind !== undefined &&
    "problem" in chooseRestoreEntity(slug, EVERY_KIND, kind)
  ) {
    return new CliError("I18N_RESTORE_KIND_INVALID", {
      what: problem,
      why: "`--kind` says which kind of entity the slug names, when more than one kind has it.",
      next: "Pass `--kind collection`, `--kind single` or `--kind field-group`, or leave `--kind` out when the slug names one entity.",
    });
  }
  if (kind !== undefined || found === 0) {
    return new CliError("I18N_RESTORE_ENTITY_NOT_FOUND", {
      what: problem,
      why: looked,
      next: "Pass `--collection` the slug of a collection, single or field group your config or `ui-schema.json` defines. An entity removed since its translations were archived has to be added back first.",
    });
  }
  // "<slug> names a collection and a field group. Say which with --kind … or --kind …."
  const sayWhich = problem.indexOf(" Say which");
  return new CliError("I18N_RESTORE_ENTITY_AMBIGUOUS", {
    what: sayWhich === -1 ? problem : problem.slice(0, sayWhich),
    why: `${looked} A field group's slugs are its own, so one slug can name a field group and a collection or single at once.`,
    next:
      sayWhich === -1
        ? "Say which with `--kind`."
        : problem.slice(sayWhich + 1),
  });
}
