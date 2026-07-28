/**
 * Guard for the table prefix the field-group storage migration will claim.
 *
 * Applied to the authored config AND to the config after plugin contributions
 * are folded in: a plugin can contribute a collection or single of its own, and
 * those entities never pass through `defineConfig`'s validation.
 *
 * @module schemas/reserved-table-prefix
 */

import { NextlyError } from "../errors";

import { FIELD_GROUP_RESERVED_TABLE_PREFIX } from "./storage-format";

/** The minimal entity shape this needs: a slug and an optional table override. */
interface EntityWithDbName {
  slug?: unknown;
  dbName?: unknown;
}

/**
 * Rejects an explicit table name that claims the reserved field-group prefix.
 *
 * Nothing is stored under the prefix yet, so this is not protecting existing
 * data — it keeps a configuration from taking the name before the migration
 * creates it, which would otherwise leave the migration renaming onto a table
 * it does not own.
 *
 * @param entities - Collections and singles to check, in any order.
 * @param origin - Where the entities came from, recorded for operators.
 * @throws NextlyError(VALIDATION) on the first entity claiming the prefix.
 */
export function assertNoReservedTablePrefix(
  entities: readonly EntityWithDbName[],
  origin: "config" | "plugin"
): void {
  for (const entity of entities) {
    const dbName = entity?.dbName;
    if (typeof dbName !== "string") continue;
    if (!dbName.toLowerCase().startsWith(FIELD_GROUP_RESERVED_TABLE_PREFIX)) {
      continue;
    }
    throw NextlyError.validation({
      errors: [
        {
          path: "dbName",
          code: "RESERVED_TABLE_PREFIX",
          message:
            `Table name '${dbName}' starts with the reserved prefix ` +
            `'${FIELD_GROUP_RESERVED_TABLE_PREFIX}', which is reserved for ` +
            `field-group storage. Choose a different 'dbName'.`,
        },
      ],
      logContext: {
        reason: "reserved-table-prefix",
        origin,
        slug: typeof entity.slug === "string" ? entity.slug : undefined,
        dbName,
      },
    });
  }
}
