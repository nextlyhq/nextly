/**
 * Codes for plugins: installing and removing them, their migrations, and the schema guard that
 * keeps one owner's migration off another owner's tables.
 *
 * Most are mappings. The lifecycle, the boot gate, the plugin migration runner and the generator
 * refuse with a message that already says what happened and what to run; those are split into
 * their parts rather than reworded, so the CLI and the server log keep one wording, and the Why
 * line adds the cause where the message leaves it to the reader.
 *
 * @module cli/errors/areas/plugins
 */

import type { NextlyError } from "../../../errors/nextly-error";
import { CliError, type CliErrorParts } from "../cli-error";
import { defineCodes } from "../define";
import {
  contextNames,
  contextNumber,
  contextString,
  sentences,
} from "../messages";

/** The sentence a refusal ends with to say the run changed nothing. */
const NOTHING_CHANGED = /^Nothing was (?:changed|applied)\.$/;

/**
 * A refusal as its three parts, in its own words: the first sentence is what happened, the
 * sentences from `nextFrom` on are next, and those between are why, after `why` when the message
 * leaves the cause out. "Nothing was changed." goes last on the Why line, wherever the message
 * put it, since it is part of what the reader needs before acting.
 */
function refusal(
  message: string,
  options: { nextFrom: number; why?: string; next?: string }
): CliErrorParts {
  const all = sentences(message);
  const kept = all.filter(sentence => !NOTHING_CHANGED.test(sentence));
  const unchanged = all.filter(sentence => NOTHING_CHANGED.test(sentence));
  const between = kept.slice(1, options.nextFrom);
  const next = kept.slice(options.nextFrom).join(" ");
  return {
    what: kept[0] ?? message,
    why:
      [
        ...(options.why === undefined ? [] : [options.why]),
        ...between,
        ...unchanged,
      ]
        .join(" ")
        .trim() || "The command refused before it changed anything.",
    next:
      next || options.next || "Run the command again once the cause is fixed.",
  };
}

/**
 * Where the schema guard found what it refused: the migration, and the table, column or element
 * with whoever holds it, each only when the refusal recorded it.
 */
function guardedAt(error: NextlyError): string | undefined {
  const source = contextString(error, "source");
  const table = contextString(error, "table");
  const column = contextString(error, "column");
  const element = contextString(error, "element");
  const belongsTo = contextString(error, "belongsTo");
  if (source === undefined) return undefined;
  if (table === undefined) return `In \`${source}\`.`;
  const named = column ?? element;
  const target = named === undefined ? `\`${table}\`` : `\`${table}.${named}\``;
  const holder =
    belongsTo === undefined ? "" : `, which \`${belongsTo}\` holds`;
  return `In \`${source}\`, on ${target}${holder}.`;
}

/** Whether a sentence tells the reader what to do, rather than what happened. */
const IMPERATIVE = /^(?:Rewrite|Run|Change|Use|Put|Split)\b/;

/**
 * A schema guard refusal, as its three parts: the first sentence says what the migration would
 * do, the guard's verdict and where it found it are why, and a closing instruction, when the
 * refusal gives one, is next.
 */
function guardRefusal(error: NextlyError, next: string): CliErrorParts {
  const [first = error.publicMessage, ...rest] = sentences(error.publicMessage);
  const instruction = rest.length > 0 && IMPERATIVE.test(rest[rest.length - 1]);
  const verdict = instruction ? rest.slice(0, -1) : rest;
  const at = guardedAt(error);
  return {
    what: first,
    why: [...(at === undefined ? [] : [at]), ...verdict].join(" ") || first,
    next: instruction ? rest[rest.length - 1] : next,
  };
}

/**
 * Whether a drop-guard refusal is one the guard could not read its way through, rather than a
 * migration taking what another owner holds: an unreadable statement records its `reason`, and
 * the forms the guard cannot follow say so.
 */
function guardCouldNotRead(error: NextlyError): boolean {
  return (
    contextString(error, "reason") !== undefined ||
    /schema guard|cannot be checked/.test(error.publicMessage)
  );
}

/** The uninstall-time checks' shared cause line: the tables a full uninstall is judged by. */
const IDENTITY_CHECK =
  "A full uninstall reads each table's identity before and after the plugin's `onUninstall`, so its DOWN migrations never drop a table the hook put in place of the one they were judged against.";

export const PLUGIN_CODES = defineCodes({
  PLUGIN_NOT_FOUND: {
    cause:
      "The plugin named on the command line is not among the plugins the configuration lists.",
  },
  PLUGIN_INSTALL_TARGET_UNCLEAR: {
    cause:
      "`nextly plugins install` was given both a plugin name and `--all`, or neither.",
  },
  PLUGIN_DISABLED: {
    cause:
      "The plugin to install or uninstall is disabled in the configuration, so its hooks would not run.",
    from: [
      {
        code: "PLUGIN_DISABLED",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "A disabled plugin's hooks do not run, so an install or uninstall of it could record a state its hook never produced. Nothing was changed.",
          }),
      },
    ],
  },
  PLUGIN_UNINSTALL_UNFINISHED: {
    cause:
      "A configured plugin's uninstall began and did not finish, so the app does not start with it.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_UNFINISHED",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "A plugin removed part way is refused in every environment, so its code never runs over the tables that are left.",
          }),
      },
    ],
  },
  PLUGIN_UNINSTALL_KEEP_DATA_MISMATCH: {
    cause:
      "An unfinished uninstall was run again with the other `--keep-data` setting than the one it began with.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_UNFINISHED",
        reason: "resumed-the-other-way",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "Run again, an uninstall carries on from where it stopped, and only the way it began: a full one may have dropped tables already, and one that kept its data has run `onUninstall` for tables it leaves.",
          }),
      },
    ],
  },
  PLUGIN_UNINSTALL_DECLINED: {
    cause:
      "The uninstall's prompt to delete the plugin's tables was answered no.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_UNCONFIRMED",
        when: error => error.logContext?.verdict === "declined",
        describe: () => ({
          what: "Nothing was changed: the deletion was not confirmed.",
          why: "A full uninstall drops the plugin's tables, and the prompt that listed them was not answered yes.",
          next: "Run the uninstall again and confirm the deletion, or use --keep-data to leave the tables in place.",
        }),
      },
    ],
  },
  PLUGIN_UNINSTALL_IRREVERSIBLE: {
    cause:
      "A full uninstall was asked of a plugin with a migration that has no DOWN to undo it.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "A full uninstall undoes every migration or none: stopping at the first that cannot be undone would leave the plugin's schema half undone. Nothing was changed.",
          }),
      },
    ],
  },
  PLUGIN_MIGRATION_NOT_SHIPPED: {
    cause:
      "A full uninstall needs the DOWN of an applied migration the configured version of the plugin no longer ships.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        reason: "module-not-shipped",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "A migration's DOWN lives in the version of the plugin that shipped it. Nothing was changed.",
          }),
      },
    ],
  },
  PLUGIN_TABLES_NOT_MIGRATED: {
    cause:
      "A plugin's tables were created by a development push, so no applied migration can undo them.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        reason: "no-applied-module",
        describe: error => {
          // "<plugin> owns N table(s), listed above, but … to undo them — they were created by …"
          const [first = error.publicMessage, ...rest] = sentences(
            error.publicMessage
          );
          const dash = first.indexOf(" — ");
          const tables = contextNames(error, "tables");
          const listed =
            tables.length > 0 ? `Its tables: ${tables.join(", ")}.` : "";
          const unchanged = rest.filter(s => NOTHING_CHANGED.test(s));
          const next = rest.filter(s => !NOTHING_CHANGED.test(s)).join(" ");
          if (dash === -1) {
            return {
              what: first,
              why: [listed, ...unchanged].filter(Boolean).join(" "),
              next,
            };
          }
          const cause = first.slice(dash + 3);
          return {
            what: `${first.slice(0, dash)}.`,
            why: [
              `${cause.charAt(0).toUpperCase()}${cause.slice(1)}`,
              listed,
              ...unchanged,
            ]
              .filter(Boolean)
              .join(" "),
            next,
          };
        },
      },
    ],
  },
  PLUGIN_DOWN_KEEPS_TABLES: {
    cause:
      "A plugin's DOWN migrations, as written, do not drop every table it owns, so a full uninstall would leave some.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        reason: "down-leaves-tables",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "A full uninstall drops every table the plugin owns, and its DOWN statements are read for that before any of them runs.",
          }),
      },
    ],
  },
  PLUGIN_DOWN_LEFT_TABLES: {
    cause:
      "A plugin's DOWN migrations ran and left a table it owns in place, so the uninstall was not recorded.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        reason: "tables-left-by-down",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "Its DOWN statements were read to drop that table before they ran, so one did something its text does not say. Its migrations are recorded as rolled back.",
          }),
      },
    ],
  },
  PLUGIN_TABLE_IDENTITY_UNREADABLE: {
    cause:
      "The database could not report the identity of a table a full uninstall drops, so the uninstall could not check its hook left it in place.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        reason: "table-identity-unreadable",
        describe: error =>
          refusal(error.publicMessage, { nextFrom: 1, why: IDENTITY_CHECK }),
      },
    ],
  },
  PLUGIN_HOOK_CHANGED_TABLES: {
    cause:
      "A plugin's `onUninstall` dropped, renamed or replaced a table its DOWN migrations were to drop.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        reason: "tables-changed-by-hook",
        describe: error =>
          refusal(error.publicMessage, { nextFrom: 1, why: IDENTITY_CHECK }),
      },
    ],
  },
  PLUGIN_HOOK_CHANGED_SCHEMA: {
    cause:
      "On SQLite, a plugin's `onUninstall` changed the database schema before its DOWN migrations ran.",
    from: [
      {
        code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
        reason: "schema-changed-by-hook",
        describe: error => refusal(error.publicMessage, { nextFrom: 2 }),
      },
    ],
  },
  PLUGIN_HAS_DEPENDENTS: {
    cause: "Another configured plugin depends on the plugin to uninstall.",
    from: [
      {
        code: "PLUGIN_HAS_DEPENDENTS",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "Removing it would leave the plugin that depends on it reading tables that are no longer there. Nothing was changed.",
          }),
      },
    ],
  },
  PLUGIN_DEPENDENCY_NOT_INSTALLED: {
    cause:
      "A plugin to install depends on a plugin that is not installed on this database.",
    from: [
      {
        code: "PLUGIN_DEPENDENCY_NOT_INSTALLED",
        describe: error => {
          // A header, one line per dependency in the order to install them, "Nothing was changed."
          const lines = error.publicMessage.split("\n");
          const header = lines[0] ?? error.publicMessage;
          const last = lines.length > 1 ? lines[lines.length - 1] : "";
          return {
            what: header.replace(/, in this order:$/, "."),
            why: [
              "Install them in this order:",
              ...lines.slice(1, -1).map(line => line.trimStart()),
              last,
            ]
              .filter(Boolean)
              .join("\n"),
            next: "Install each dependency listed, in the order shown, then run this install again.",
          };
        },
      },
    ],
  },
  PLUGIN_NOT_INSTALLED: {
    cause:
      "In production, a configured plugin has not been installed on this database.",
    from: [
      {
        code: "PLUGIN_NOT_INSTALLED",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "In production a configured plugin starts only once `nextly plugins install` has run its `onInstall` and recorded it.",
          }),
      },
    ],
  },
  PLUGIN_UNINSTALLED_BUT_CONFIGURED: {
    cause:
      "A plugin that has been uninstalled is still listed in the configuration.",
    from: [
      {
        code: "PLUGIN_SCHEMA_UNINSTALLED",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "Started again, it would run over tables its uninstall removed, and a development push would create them again, so it is refused in every environment.",
          }),
      },
    ],
  },
  PLUGIN_SCHEMA_BEHIND: {
    cause:
      "In production, a plugin expects a schema version its applied migrations have not reached.",
    from: [
      {
        code: "PLUGIN_SCHEMA_BEHIND",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "The applied version is the newest `schemaVersion` among the plugin's migrations recorded as applied, and production does not start a plugin ahead of its tables.",
          }),
      },
    ],
  },
  PLUGIN_SHIPS_NO_MIGRATIONS: {
    cause:
      "A plugin declares tables or table elements and ships no migrations to create them.",
    from: [
      {
        code: "PLUGIN_MIGRATIONS_UNAVAILABLE",
        describe: error => {
          // "A plugin declares … to create them. They exist in development through push; generate
          // the plugin's migrations before deploying."
          const [what = error.publicMessage, ...rest] = sentences(
            error.publicMessage
          );
          const [why, next] = rest.join(" ").split("; ");
          const tables = contextNames(error, "tables");
          return {
            what,
            why: [
              next === undefined
                ? why
                : `${why}, and a deployed database gets its tables only from migrations.`,
              ...(tables.length > 0
                ? [`Not migrated: ${tables.join(", ")}.`]
                : []),
            ]
              .filter(Boolean)
              .join(" "),
            next: "Generate the plugin's migrations before deploying, with `nextly migrate:create --plugin <entry>`.",
          };
        },
      },
    ],
  },
  PLUGIN_MIGRATION_CHANGED: {
    cause:
      "A plugin's migration module has changed since it was generated, so its checksum no longer matches its content.",
    from: [
      {
        code: "MIGRATION_CHECKSUM_MISMATCH",
        // The module's own seal: the refusal records the checksum it carries as `expected`.
        when: error => error.logContext?.expected !== undefined,
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "An edited module is refused rather than re-hashed, so the SQL that runs is the SQL that was reviewed. Nothing was applied.",
          }),
      },
    ],
  },
  PLUGIN_APPLIED_MIGRATION_CHANGED: {
    cause:
      "A plugin migration recorded as applied no longer matches the module that ran on this database.",
    from: [
      {
        code: "MIGRATION_CHECKSUM_MISMATCH",
        // Against the ledger: the refusal records the checksum of what ran as `applied`.
        when: error => error.logContext?.applied !== undefined,
        describe: error => refusal(error.publicMessage, { nextFrom: 2 }),
      },
    ],
  },
  PLUGIN_APPLIED_MIGRATION_REMOVED: {
    cause:
      "A plugin no longer lists a migration the database records as applied.",
    from: [
      {
        code: "PLUGIN_MIGRATION_HISTORY_CHANGED",
        reason: "applied-module-missing",
        describe: error => refusal(error.publicMessage, { nextFrom: 2 }),
      },
    ],
  },
  PLUGIN_MIGRATION_BEFORE_APPLIED: {
    cause: "A plugin lists a migration that has not run ahead of one that has.",
    from: [
      {
        code: "PLUGIN_MIGRATION_HISTORY_CHANGED",
        reason: "pending-before-applied",
        describe: error => refusal(error.publicMessage, { nextFrom: 2 }),
      },
    ],
  },
  PLUGIN_MIGRATIONS_OUT_OF_ORDER: {
    cause:
      "A plugin lists its migrations in an order other than the order of their names.",
    from: [
      {
        code: "PLUGIN_MIGRATIONS_OUT_OF_ORDER",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "Every reader of a plugin's migrations runs them by name, so a list in another order is refused rather than sorted in silence.",
          }),
      },
    ],
  },
  PLUGIN_MIGRATION_SQL_MISSING: {
    cause:
      "A plugin migration changes the schema on this database's dialect and has no statements for it.",
    from: [
      {
        code: "PLUGIN_MIGRATION_SQL_MISSING",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "A module written for its author's SQL, such as one from `nextly migrate:create --plugin <entry> --blank`, runs only the statements it is given.",
          }),
      },
    ],
  },
  PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN: {
    cause:
      "A plugin migration would add a NOT NULL column with no default to a table that already has rows.",
    from: [
      {
        code: "PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "SQLite refuses such a column, PostgreSQL refuses it once the table has rows, and MySQL fills the rows with 0 or '' without saying so, so it is refused on every dialect when the migration is generated.",
          }),
      },
    ],
  },
  PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA: {
    cause:
      "A generated plugin migration would drop a table or column an earlier migration of the plugin created.",
    from: [
      {
        code: "PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA",
        describe: error =>
          refusal(error.publicMessage, {
            nextFrom: 1,
            why: "The generator cannot tell a rename from a drop and an add, so it does not drop what the plugin created on its own.",
          }),
      },
    ],
  },
  PLUGIN_SCHEMA_VERSION_NOT_ADVANCED: {
    cause:
      "A plugin's declared `schemaVersion` does not move past the one on its last migration.",
    from: [
      {
        code: "PLUGIN_SCHEMA_VERSION_NOT_ADVANCED",
        describe: error => {
          const plugin = contextString(error, "plugin");
          const previous = contextNumber(error, "previousSchemaVersion");
          const declared = contextNumber(error, "declared");
          const named = plugin === undefined ? "the plugin" : `\`${plugin}\``;
          const behind =
            previous !== undefined &&
            declared !== undefined &&
            declared < previous;
          const [what = error.publicMessage, ...rest] = sentences(
            error.publicMessage
          );
          return {
            what,
            why: [
              ...rest,
              "The runner takes a plugin's schema version from its last migration, so a new migration that changes the schema must declare a higher one.",
            ].join(" "),
            next:
              previous === undefined
                ? `Raise \`schemaVersion\` in ${named}, then generate the migration again.`
                : behind
                  ? `Set \`schemaVersion\` in ${named} to ${String(previous)} or more, then generate the migration again.`
                  : `Raise \`schemaVersion\` in ${named} above ${String(previous)}, then generate the migration again.`,
          };
        },
      },
    ],
  },
  DROP_OF_FOREIGN_TABLE: {
    cause:
      "A migration would drop, rename or change a table, column or index that belongs to a different owner.",
    from: [
      {
        code: "DROP_OF_FOREIGN_TABLE",
        describe: error =>
          guardRefusal(
            error,
            "Change only what this migration's owner holds: a change to another owner's table belongs in that owner's migrations."
          ),
      },
    ],
  },
  MIGRATION_SQL_UNCHECKABLE: {
    cause:
      "A migration's SQL is in a form the schema guard cannot read, so it cannot check the migration leaves other owners' tables alone.",
    from: [
      {
        code: "DROP_OF_FOREIGN_TABLE",
        when: guardCouldNotRead,
        describe: error => {
          const reason = contextString(error, "reason");
          if (reason === undefined) {
            return guardRefusal(
              error,
              "Rewrite the statement as plain SQL on the table it names, one change per statement."
            );
          }
          // An unreadable statement: the guard records what it could not read as `reason`.
          const source = contextString(error, "source");
          const [what = error.publicMessage, ...rest] = sentences(
            error.publicMessage
          );
          return {
            what,
            why: [
              `${source === undefined ? "A statement" : `A statement in \`${source}\``} could not be read: ${reason}.`,
              ...rest,
            ].join(" "),
            next: "Rewrite that statement as plain SQL the guard can read; `--verbose` shows the statement.",
          };
        },
      },
    ],
  },
});

/** `nextly plugins info <name>` named a plugin the configuration does not list. */
export function pluginNotFound(name: string): CliError {
  return new CliError("PLUGIN_NOT_FOUND", {
    what: `Plugin "${name}" not found.`,
    why: "No plugin the configuration lists has that name or admin slug.",
    next: "Run `nextly plugins list` to see installed plugins.",
  });
}

/** `nextly plugins install` given a name with `--all`, or neither. */
export function installTargetUnclear(name: string | undefined): CliError {
  return new CliError("PLUGIN_INSTALL_TARGET_UNCLEAR", {
    what:
      name === undefined
        ? "`nextly plugins install` was not told which plugin to install."
        : `\`nextly plugins install\` was given both "${name}" and \`--all\`.`,
    why: "It installs one named plugin, or every configured plugin with `--all`, never both.",
    next: 'Name one plugin to install, or pass --all to install every configured plugin: "nextly plugins install <name>" or "nextly plugins install --all".',
  });
}
