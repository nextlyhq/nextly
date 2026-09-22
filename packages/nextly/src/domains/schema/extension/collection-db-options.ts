/**
 * Per-collection database options, and the one global one.
 *
 * Small surfaces with sharp edges, so each rule is here rather than at its
 * call site.
 *
 * @module domains/schema/extension/collection-db-options
 * @since 1.0.0
 */
import { randomUUID } from "node:crypto";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { uuidV7 } from "../../../utils/uuid-v7";

/** Which id a collection generates. The storage stays varchar(36)/text. */
export type IdType = "uuid" | "uuidv7";

/**
 * Generate an id of the configured type.
 *
 * The STORAGE does not change with the type — both are 36 characters in the
 * same column — which is what keeps relations, the REST API and the admin
 * unaffected. Only the bytes differ, and with them whether inserts append to
 * the index or scatter across it.
 */
export function generateId(idType: IdType): string {
  return idType === "uuidv7" ? uuidV7() : randomUUID();
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accept a client-supplied id, or refuse it.
 *
 * Validated by SHAPE rather than by version. A v4 id in a uuidv7 collection
 * sorts badly and is otherwise correct, so refusing it would reject data that
 * works — while accepting arbitrary strings would let a caller choose a key
 * that collides with a future generated one.
 */
export function assertUsableClientId(
  id: unknown,
  allowIdOnCreate: boolean,
  slug: string
): string {
  if (!allowIdOnCreate) {
    throw NextlyError.validation({
      errors: [
        {
          path: "id",
          code: "INVALID",
          message: `"${slug}" does not accept a client-supplied id. Enable db.allowIdOnCreate to change that.`,
        },
      ],
    });
  }
  if (typeof id !== "string" || !UUID_SHAPE.test(id)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "id",
          code: "INVALID",
          message: "A supplied id must be a UUID.",
        },
      ],
    });
  }
  return id;
}

/**
 * Whether a field materialises a column.
 *
 * `virtual` extends to every field type the rule that group and repeater
 * fields already follow: no column, excluded from inserts and selects,
 * computed in `afterRead`. It reuses the existing "descriptor returns null"
 * path rather than adding a second one, because every consumer already
 * honours that for component fields — a new mechanism would need each of them
 * taught again, and the one that was missed would emit a column for a field
 * that has no value.
 */
export function fieldProducesColumn(field: {
  virtual?: boolean;
  type?: string;
}): boolean {
  return field.virtual !== true;
}

/**
 * The PostgreSQL schema every managed table lives in.
 *
 * MySQL and SQLite have no equivalent, so the option is IGNORED there with a
 * warning rather than refused. Refusing would make one config file unusable
 * across dialects, which defeats the point of a portable schema; ignoring it
 * silently would leave an operator believing their tables were namespaced.
 */
export function resolvePostgresSchema(
  configured: string | undefined,
  dialect: SupportedDialect,
  warn: (message: string) => void
): string | null {
  if (configured === undefined) return null;
  if (dialect !== "postgresql") {
    warn(
      `db.postgres.schema is set to "${configured}", which only PostgreSQL supports. It is ignored on ${dialect}.`
    );
    return null;
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(configured)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "db.postgres.schema",
          code: "INVALID",
          message: `"${configured}" is not a usable PostgreSQL schema name.`,
        },
      ],
    });
  }
  return configured;
}
