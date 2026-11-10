/**
 * A many-to-many a save adds to a collection whose table is not the one its slug spells, refused.
 *
 * A junction's generated name and its link column for this collection are spelled from the
 * collection's slug where its reads and writes find them, and from its table where the schema
 * creates it. They agree while the table is the one the slug spells. A renamed collection keeps the
 * table it was created under, so the two differ, and a junction created for it would be one its
 * relationship can't read. A many-to-many the collection already has keeps its junction, and one
 * pointing at the collection from another works, since a target is found through the registry.
 *
 * @module domains/dynamic-collections/services/junctions-on-renamed-collections
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { getTableName } from "../../collections/services/collection-utils";
import { usesJunctionTable } from "../../schema/services/field-column-descriptor";

/** The validation code a refused many-to-many carries. */
const REFUSAL_CODE = "MANY_TO_MANY_ON_RENAMED_COLLECTION";

/**
 * Refuse the many-to-many fields `newFields` adds (a field `oldFields` did not have as one) when
 * `tableName` is not the table `slug` spells, naming each. A precondition: asked before the save
 * writes or alters anything.
 */
export function refuseNewJunctionsOnRenamedCollection(args: {
  slug: string;
  tableName: string;
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
}): void {
  if (args.tableName === getTableName(args.slug)) return;
  const had = new Set(
    args.oldFields.filter(usesJunctionTable).map(field => field.name)
  );
  const added = args.newFields
    .filter(field => usesJunctionTable(field) && !had.has(field.name))
    .map(field => field.name)
    .sort();
  if (added.length === 0) return;
  throw NextlyError.validation({
    errors: added.map(name => ({
      path: `fields.${name}`,
      code: REFUSAL_CODE,
      message:
        `"${name}" can't be added as a many-to-many here: this collection was renamed, and the ` +
        `table its links would be kept in is spelled from its old name. Add the relationship ` +
        `from the other collection instead, pointing at this one.`,
    })),
    logContext: {
      slug: args.slug,
      tableName: args.tableName,
      fields: added,
    },
  });
}
