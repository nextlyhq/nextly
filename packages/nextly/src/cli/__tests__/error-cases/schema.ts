/**
 * Cases for the schema pipeline, the Builder's definitions and the PostgreSQL schema.
 *
 * @module cli/__tests__/error-cases/schema
 */
import { occupiedRefusal } from "../../../domains/schema/services/leftover-storage";
import {
  assertAdapterPostgresSchema,
  refuseMovedInstallation,
  validatePostgresSchema,
} from "../../../domains/schema/services/postgres-schema";
import { NextlyError } from "../../../errors/nextly-error";
import { CliError } from "../../errors";
import { parseUiSchema } from "../../../schemas/_zod/ui-schema";

import { PROJECT, type ErrorCases } from "./types";

/** What `fn` throws; a case whose thrower returns has failed to reach its cause. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

export const SCHEMA_CASES = {
  // Retired: nothing raises it now, so the case is the error as its last release printed it, which
  // the code's docs page keeps as its example.
  POSTGRES_SCHEMA_UNSUPPORTED: () =>
    new CliError("POSTGRES_SCHEMA_UNSUPPORTED", {
      what: 'db.postgres.schema is "tenant_a", but a PostgreSQL schema other than "public" is not supported yet.',
      why: 'Nextly can only create and migrate its tables in "public".',
      next: 'Remove db.postgres.schema (and any schema option on the database adapter), or set it to "public".',
    }),
  POSTGRES_SCHEMA_MOVED: () =>
    thrownBy(() => refuseMovedInstallation("tenant_a", ["public"], false)),
  POSTGRES_SCHEMA_MISMATCH: () =>
    thrownBy(() => assertAdapterPostgresSchema("public", "tenant_a")),
  POSTGRES_SCHEMA_INVALID: () =>
    thrownBy(() => validatePostgresSchema("Tenant-A")),
  // The refusal a Single's create throws when its leftover table holds rows.
  CREATE_STORAGE_TAKEN: () =>
    occupiedRefusal(
      { kind: "single", slug: "home", tableName: "single_home" },
      [{ table: "single_home", rows: 3 }]
    ),
  // As `loadUiSchema` in `domains/schema/ui-schema/loader.ts` throws it for a file it cannot read.
  UI_SCHEMA_UNREADABLE: () =>
    new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage: `Failed to read ui-schema file at ${PROJECT}/ui-schema.json: EACCES: permission denied, open '${PROJECT}/ui-schema.json'`,
    }),
  // As `loadUiSchema` throws it for a file that does not parse, with the parser's message fixed
  // here, since its wording differs between Node versions.
  UI_SCHEMA_NOT_JSON: () =>
    new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage:
        'ui-schema.json is not valid JSON: Unexpected token \'}\', "{ "collections": [ }" is not valid JSON',
    }),
  // As `loadUiSchema` throws it, from the manifest schema's own issues for an entry it rejects.
  UI_SCHEMA_INVALID: () => {
    const result = parseUiSchema({
      collections: [{ slug: "Posts", fields: [] }],
    });
    if (result.success) throw new Error("expected the manifest to fail");
    const issues = result.error.issues
      .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage: `ui-schema.json failed validation: ${issues}`,
    });
  },
  // As `assertHeldToTheEnd` in `domains/schema/pipeline/schema-lock.ts` throws it.
  SCHEMA_LOCK_LOST: () =>
    NextlyError.serviceUnavailable({
      publicMessage:
        "db:sync finished, but could not keep the schema lock to the end: another run took " +
        "it while the work ran. Check the database before running it again.",
      logContext: { reason: "schema lock lost while held", command: "db:sync" },
    }),
  // As `heldByRow` in `domains/schema/pipeline/schema-lock.ts` throws it.
  SCHEMA_LOCK_UNAVAILABLE: () =>
    NextlyError.serviceUnavailable({
      logMessage:
        "the schema lock row could not be established; refusing to run unprotected",
      logContext: {
        reason: "schema lock row missing",
        table: "nextly_schema_lock",
      },
    }),
  // As `interruptedBeforeStart` in `domains/schema/pipeline/schema-lock.ts` builds it.
  INTERRUPTED_BEFORE_START: () =>
    NextlyError.serviceUnavailable({
      publicMessage:
        "`nextly migrate` was interrupted before it started; nothing was changed.",
      logContext: {
        reason: "interrupted before the work started",
        command: "nextly migrate",
      },
    }),
  // As a Schema Builder save throws it: the text `nextly migrate` prints for the same state.
  NEXTLY_MIGRATION_HISTORY_REFUSED: () =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
      publicMessage:
        "Applied migration 20261106_120000_000_posts_create.sql was changed after it ran. Restore it as it was applied, or record the change with `nextly migrate:resolve --applied 20261106_120000_000_posts_create.sql`.",
      logContext: { refusedBy: "MIGRATION_TAMPERED" },
    }),
  // As a Schema Builder save throws it for a converted column nobody confirmed.
  NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED: () =>
    new NextlyError({
      code: "NEXTLY_SCHEMA_CONVERSION_UNCONFIRMED",
      publicMessage:
        "This save also converts body from text to varchar(255), from an earlier Nextly version. Review the save and confirm the conversion to write it.",
      logContext: { columns: ["body"] },
    }),
} satisfies ErrorCases;
