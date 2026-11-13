/**
 * Codes for the schema pipeline, the Builder's definitions and the PostgreSQL schema.
 *
 * All are mappings: the pipeline and its services throw, and a command that runs them ends as
 * one of these. Where the thrown message already says what happened, why and what to do, it is
 * split into those parts rather than reworded, so the CLI and the server log keep one wording.
 *
 * @module cli/errors/areas/schema
 */

import type { NextlyError } from "../../../errors/nextly-error";
import type { CliErrorParts } from "../cli-error";
import { defineCodes } from "../define";
import { asSentence, contextString, sentences } from "../messages";

/**
 * A create refused over storage nothing registered owns, as its three parts. The refusal reads
 * "Creating the <kind> "<slug>" was refused: <what stands there>. <what to do>.", so the part before
 * the colon is what happened, the rest of that sentence why, and the last sentence what to do.
 */
function leftoverStorageRefusal(error: NextlyError): CliErrorParts {
  const parts = sentences(error.publicMessage);
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const body = (last === undefined ? parts : parts.slice(0, -1)).join(" ");
  const colon = body.indexOf(": ");
  return {
    what: colon === -1 ? body : `${body.slice(0, colon)}.`,
    why:
      colon === -1
        ? "Tables or other objects that nothing registered owns stand where it would build."
        : asSentence(body.slice(colon + 2)),
    next:
      last ??
      "Drop or rename the tables the message names, then retry the create.",
  };
}

/**
 * The refusal of a start whose configured schema holds no installation while another schema of
 * the database does, as its three parts: where the setting points and where the installation is,
 * why starting would be wrong, and the two ways forward.
 */
function movedSchema(error: NextlyError): CliErrorParts {
  const [what = error.publicMessage, why, ...next] = sentences(
    error.publicMessage
  );
  return {
    what,
    why:
      why ??
      "Starting would create a second, empty installation in the configured schema and serve it instead of the existing one.",
    next:
      next.join(" ") ||
      "Point db.postgres.schema back at the schema the installation is in.",
  };
}

/**
 * The refusal of a config and an adapter naming different schemas, as its three parts: the
 * disagreement, why both must agree, and the two edits that make them agree.
 */
function mismatchedSchema(error: NextlyError): CliErrorParts {
  const [what = error.publicMessage, why, ...next] = sentences(
    error.publicMessage
  );
  return {
    what,
    why:
      why ??
      "Both must name the same schema, or tables and migrations end up split between them.",
    next:
      next.join(" ") ||
      "Make the database adapter's schema option and db.postgres.schema name the same schema.",
  };
}

/** The issue a schema-name refusal carries, in `publicData.errors`. */
function issueMessage(error: NextlyError): string | undefined {
  const data = error.publicData as
    | { errors?: Array<{ message?: unknown }> }
    | undefined;
  const message = data?.errors?.[0]?.message;
  return typeof message === "string" ? message : undefined;
}

/**
 * A schema name PostgreSQL cannot use, as its three parts.
 *
 * The issue reads '"x" is not a usable schema name. Use lower-case letters, …'. The name is
 * taken from the log context rather than the first stop, since the name the user wrote may hold
 * one itself.
 */
function invalidSchemaName(error: NextlyError): CliErrorParts {
  const name = contextString(error, "name") ?? "";
  const message = issueMessage(error) ?? "";
  const head = `"${name}" is not a usable schema name.`;
  const rule = message.startsWith(head)
    ? message.slice(head.length).trim()
    : "";
  return {
    what: `db.postgres.schema is "${name}", which is not a usable schema name.`,
    why: "The name reaches SQL through the connection's `search_path`, where an unusable one would connect and then find nothing.",
    next:
      rule ||
      'Use lower-case letters, digits and underscores, starting with a letter or underscore (max 63 characters), and not beginning with "pg_".',
  };
}

/** Whether `error`'s message starts with the words its throw site gives one cause. */
const startsWith =
  (prefix: string) =>
  (error: NextlyError): boolean =>
    error.publicMessage.startsWith(prefix);

/** What follows the first `": "` of the message: the reader's or the parser's own reason. */
function afterPrefix(message: string): string {
  const colon = message.indexOf(": ");
  return colon === -1 ? message : message.slice(colon + 2);
}

/** The command a lock refusal names, as the user typed it. */
function lockCommand(error: NextlyError): string {
  return (
    contextString(error, "command") ??
    contextString(error, "label") ??
    "The command"
  );
}

/** A command named in backticks, or the generic subject when none is recorded. */
function commandSubject(error: NextlyError): string {
  const command = lockCommand(error);
  return command === "The command" ? command : `\`${command}\``;
}

export const SCHEMA_CODES = defineCodes({
  POSTGRES_SCHEMA_UNSUPPORTED: {
    cause:
      "`db.postgres.schema` names a PostgreSQL schema other than `public`, which Nextly cannot create its tables in yet.",
    retired: {
      why: "Nextly now creates and migrates its tables in any PostgreSQL schema `db.postgres.schema` names.",
    },
  },
  POSTGRES_SCHEMA_MOVED: {
    cause:
      "`db.postgres.schema` names a PostgreSQL schema holding no Nextly installation, while another schema of the same database holds one.",
    from: [
      {
        code: "NEXTLY_POSTGRES_SCHEMA_MOVED",
        describe: movedSchema,
      },
    ],
  },
  POSTGRES_SCHEMA_MISMATCH: {
    cause:
      "`db.postgres.schema` and the database adapter's schema option name different PostgreSQL schemas.",
    from: [
      {
        code: "NEXTLY_POSTGRES_SCHEMA_MISMATCH",
        describe: mismatchedSchema,
      },
    ],
  },
  POSTGRES_SCHEMA_INVALID: {
    cause:
      "`db.postgres.schema` is not a name PostgreSQL can use for a schema.",
    from: [
      {
        code: "VALIDATION_ERROR",
        reason: "postgres-schema-invalid",
        describe: invalidSchemaName,
      },
    ],
  },
  UI_SCHEMA_UNREADABLE: {
    cause:
      "The Schema Builder's `ui-schema.json` exists but could not be read.",
    from: [
      {
        code: "NEXTLY_UI_SCHEMA_INVALID",
        when: startsWith("Failed to read ui-schema file at "),
        describe: error => {
          // "Failed to read ui-schema file at <path>: <the reader's reason>".
          const message = error.publicMessage;
          const prefix = "Failed to read ui-schema file at ";
          const colon = message.indexOf(": ", prefix.length);
          return {
            what: `${colon === -1 ? message : message.slice(0, colon)}.`,
            why:
              colon === -1
                ? "The file could not be opened."
                : message.slice(colon + 2),
            next: "Check that the file is readable by the user running the command, or point `db.uiSchemaFile` in `nextly.config.ts` at the right file.",
          };
        },
      },
    ],
  },
  UI_SCHEMA_NOT_JSON: {
    cause: "The Schema Builder's `ui-schema.json` is not valid JSON.",
    from: [
      {
        code: "NEXTLY_UI_SCHEMA_INVALID",
        when: startsWith("ui-schema.json is not valid JSON"),
        describe: error => ({
          what: "ui-schema.json is not valid JSON.",
          why: afterPrefix(error.publicMessage),
          next: "Fix the JSON at the position named, or restore `ui-schema.json` from version control, then run the command again.",
        }),
      },
    ],
  },
  UI_SCHEMA_INVALID: {
    cause:
      "The Schema Builder's `ui-schema.json` holds an entry the manifest's schema rejects.",
    from: [
      {
        code: "NEXTLY_UI_SCHEMA_INVALID",
        describe: error => {
          const message = error.publicMessage;
          const colon = message.indexOf(": ");
          return {
            what:
              colon === -1
                ? message
                : `${message.slice(0, colon).replace(/^ui-schema(\.json)?/, "`ui-schema.json`")}.`,
            // One issue per line, each as `path: message`, as the manifest's check lists them.
            why: afterPrefix(message).split("; ").join("\n"),
            next: "Fix each entry listed in `ui-schema.json`, or make the change again in the Schema Builder, then run the command again.",
          };
        },
      },
    ],
  },
  SCHEMA_LOCK_LOST: {
    cause:
      "Another run took the schema lock while the command still held it, so the two may have changed the schema at once.",
    from: [
      {
        code: "SERVICE_UNAVAILABLE",
        reason: "schema lock lost while held",
        describe: error => {
          const message = error.publicMessage;
          const colon = message.indexOf(": ");
          const [why, ...next] = sentences(
            colon === -1 ? "" : message.slice(colon + 2)
          );
          return {
            what:
              colon === -1
                ? `${commandSubject(error)} finished, but could not keep the schema lock to the end.`
                : `${message.slice(0, colon)}.`,
            why:
              why === undefined
                ? "Another run took it while the work ran."
                : `${why[0].toUpperCase()}${why.slice(1)}`,
            next:
              next.join(" ") || "Check the database before running it again.",
          };
        },
      },
    ],
  },
  SCHEMA_LOCK_UNAVAILABLE: {
    cause:
      "The schema lock's row could not be established, so the command refused to run without it.",
    from: [
      {
        code: "SERVICE_UNAVAILABLE",
        reason: "schema lock row missing",
        describe: error => ({
          what: "The command did not run: the schema lock could not be taken.",
          why: `Its row in \`${contextString(error, "table") ?? "nextly_schema_lock"}\` could not be established, and running without the lock would leave other runs free to change the schema at the same time.`,
          next: "Check that the database user can create and write that table, then run the command again; `--verbose` shows the details.",
        }),
      },
    ],
  },
  INTERRUPTED_BEFORE_START: {
    cause:
      "The command was interrupted while it waited to take a schema lock, before it changed anything.",
    from: [
      {
        code: "SERVICE_UNAVAILABLE",
        reason: "interrupted before the work started",
        describe: error => {
          const message = error.publicMessage;
          // The schema lock's own refusal says it in full; the field-group lock's carries a label.
          const written = message.includes("interrupted before it started");
          return {
            what: written
              ? message.slice(0, message.indexOf(";")) + "."
              : `${commandSubject(error)} was interrupted before it started.`,
            why: "It was stopped while it waited for the schema lock, so it released its place and nothing was changed.",
            next: "Run it again when you are ready.",
          };
        },
      },
    ],
  },
  // A Schema Builder save writes a migration, so it asks the history checks
  // `nextly migrate` asks first; its refusal carries that command's own text.
  NEXTLY_MIGRATION_HISTORY_REFUSED: {
    cause:
      "A Schema Builder save was refused before it wrote anything, because the migration history `nextly migrate` checks does not hold.",
    from: [
      {
        code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
        describe: error => ({
          what: error.publicMessage,
          why: "A save writes a migration into the folder, and the folder or its ledger is in a state `nextly migrate` refuses: an applied file was edited or removed, or an attempt is unfinished.",
          next: "Settle what the message names, with `nextly migrate:resolve` or by restoring the file, then save again.",
        }),
      },
    ],
  },
  NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED: {
    cause:
      "A Schema Builder save would convert a column of a table an earlier version made that the person saving did not confirm.",
    from: [
      {
        code: "NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED",
        describe: error => ({
          what: error.publicMessage,
          why: "The column's type differs from what its field makes now, and a save converts only the columns its review showed.",
          next: "Review the save in the Schema Builder and confirm the conversion, or pass the column in `acknowledgedConversions`.",
        }),
      },
    ],
  },
  // A field group's or Single's create checks the storage it would build in first, and refuses
  // when something nothing registered owns stands there: objects in its place, a leftover table
  // others reference, or one holding rows. Each refusal names the tables and what to do.
  CREATE_STORAGE_TAKEN: {
    cause:
      "A field group or Single would be created where tables or other objects that nothing registered owns already stand.",
    from: [
      {
        code: "CONFLICT",
        reason: "create-objects-taken",
        describe: leftoverStorageRefusal,
      },
      {
        code: "CONFLICT",
        reason: "create-table-referenced",
        describe: leftoverStorageRefusal,
      },
      {
        code: "CONFLICT",
        reason: "create-table-occupied",
        describe: leftoverStorageRefusal,
      },
    ],
  },
});
