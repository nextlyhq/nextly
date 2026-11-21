/**
 * A migration that drops a collection or Single something still uses is refused before it runs,
 * as the Schema Builder refuses its delete (`assertNothingDependsOn`): a field of a declared entity
 * naming it, a foreign key a plugin or the app declares on its own table, or another owner's
 * element on one of its tables. Whether `migrate:create` wrote the drop or a person did, nothing is
 * removed and the refusal names what uses it.
 *
 * Judged from the files' statements: a DROP TABLE of a registered entity's main table drops the
 * entity, and its other tables go with it. Read before any file runs, so on MySQL, where each
 * drop commits as it runs, no attempt is recorded for a file that would be refused part-way.
 *
 * @module domains/schema/migrate/used-entity-drops
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  assertNothingDependsOn,
  databaseDependentsSources,
  type DependentsAdapter,
} from "../../collections/services/collection-dependents";
import type { ExtensionSchemaRecord } from "../ownership/dependent-elements";

import { readCoveredEntities } from "./entity-coverage";
import { tablesDroppedBy } from "./statement-targets";

/**
 * Refuses the run when `units` drop the main table of a collection or Single something still
 * uses. A plugin's entity, or Nextly's own, is not an app migration's to retire, and is left to
 * the guard that refuses another owner's drop.
 */
export async function refuseDropsOfUsedEntities(args: {
  adapter: DependentsAdapter;
  db: unknown;
  dialect: SupportedDialect;
  units: readonly { statements: readonly string[] }[];
  extensionSchema: () => Promise<ExtensionSchemaRecord | null>;
}): Promise<void> {
  const dropped = new Set(
    args.units.flatMap(unit =>
      unit.statements.flatMap(
        statement => tablesDroppedBy(statement, args.dialect) ?? []
      )
    )
  );
  if (dropped.size === 0) return;
  const retiring = (await readCoveredEntities(args.db, args.dialect)).filter(
    entity =>
      entity.excluded !== true &&
      entity.kind !== "fieldGroup" &&
      dropped.has(entity.table.toLowerCase())
  );
  if (retiring.length === 0) return;
  await assertNothingDependsOn(
    retiring.map(entity => ({
      kind: entity.kind,
      slug: entity.slug,
      tables: entity.tables,
    })),
    databaseDependentsSources(args.adapter, args.extensionSchema),
    // The fields of the collections dropped together go with them.
    {
      fieldsGoWith: retiring
        .filter(entity => entity.kind === "collection")
        .map(entity => entity.slug),
    }
  );
}
