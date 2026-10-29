/**
 * Cases for the schema pipeline, the Builder's definitions and the PostgreSQL schema.
 *
 * @module cli/__tests__/error-cases/schema
 */
import {
  assertAdapterPostgresSchema,
  assertSupportedPostgresSchema,
  validatePostgresSchema,
} from "../../../domains/schema/services/postgres-schema";
import { NextlyError } from "../../../errors/nextly-error";
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
  POSTGRES_SCHEMA_UNSUPPORTED: () =>
    thrownBy(() => assertSupportedPostgresSchema("tenant_a")),
  POSTGRES_SCHEMA_MISMATCH: () =>
    thrownBy(() => assertAdapterPostgresSchema("public", "tenant_a")),
  POSTGRES_SCHEMA_INVALID: () =>
    thrownBy(() => validatePostgresSchema("Tenant-A")),
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
} satisfies ErrorCases;
