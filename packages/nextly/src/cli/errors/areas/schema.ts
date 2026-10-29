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

/** The message's sentences: each ends at a stop followed by a space, or at the end. */
function sentences(message: string): string[] {
  return message
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

/** A `logContext` value as a string, or undefined when it is not one. */
function contextString(error: NextlyError, key: string): string | undefined {
  const value = error.logContext?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The refusal of a PostgreSQL schema other than `public`, as its three parts.
 *
 * The message is "db.postgres.schema is "x", but … is not supported yet: Nextly can only create
 * and migrate its tables in "public". Remove db.postgres.schema …, or set it to "public"." The
 * clause before the colon is what happened, the one after it why, and the last sentence next.
 */
function unsupportedSchema(error: NextlyError): CliErrorParts {
  const [first = error.publicMessage, ...rest] = sentences(error.publicMessage);
  const colon = first.indexOf(": ");
  return {
    what: colon === -1 ? first : `${first.slice(0, colon)}.`,
    why:
      colon === -1
        ? 'Nextly can only create and migrate its tables in "public".'
        : first.slice(colon + 2),
    next:
      rest.join(" ") ||
      'Remove db.postgres.schema, or set it to "public", in `nextly.config.ts`.',
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
    from: [
      {
        code: "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED",
        describe: unsupportedSchema,
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
});
