/**
 * Which fields a save keeps by name but stores differently: a write prepared before the save would
 * read or write each where, or as, it no longer is.
 *
 * @module domains/schema/services/fields-stored-differently
 */
import { isDeepStrictEqual } from "node:util";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { sharedStructureShape } from "../../i18n/shared-structure";
import {
  fieldTypeChangesOf,
  perLanguageAfter,
} from "../value-conversion/type-change/field-type-changes";

import type { ColumnOrigin } from "./field-column-descriptor";
import { fieldsStoredOnRow } from "./field-column-descriptor";
import { linkMoveOf } from "./field-storage-moves";
import { sameRelationTarget } from "./relationship-key-target";

/**
 * The names of the fields `next` keeps from `previous`, stored differently: a many-to-many whose
 * links are in another table, or a relationship that points at another collection (`linkMoveOf`,
 * `sameRelationTarget`); a field that joins or leaves translation, as its storage reads it
 * (`translatedAsStored`); where the entity keeps values per language, a container whose text inside
 * is split otherwise between its structure and each language (`sharedStructureShape`); and a column
 * of another type (`fieldTypeChangesOf`).
 * Asked where the two definitions differ: a change that stores nothing differently (a label, a
 * hint) names none.
 */
export function fieldsStoredDifferently(args: {
  previous: readonly FieldDefinition[];
  next: readonly FieldDefinition[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  /** The entity, by whether it is translated, which with the layout decides where values are kept. */
  entity: { localized?: unknown };
}): ReadonlySet<string> {
  const translatedBefore = translatedAsStored(args.entity, args.previous);
  const translatedAfter = translatedAsStored(args.entity, args.next);
  const perLanguage = storesPerLanguage(args.entity);
  const before = new Map(
    fieldsStoredOnRow(args.previous).map(field => [field.name, field])
  );
  const changed = new Set<string>();
  for (const now of fieldsStoredOnRow(args.next)) {
    const was = before.get(now.name);
    if (was === undefined) continue;
    if (
      linkMoveOf(was, now) !== null ||
      (was.type === "relationship" &&
        now.type === "relationship" &&
        !sameRelationTarget(was, now)) ||
      translatedBefore.has(was.name) !== translatedAfter.has(now.name) ||
      (perLanguage && splitOtherwise(was, now))
    ) {
      changed.add(now.name);
    }
  }
  for (const change of fieldTypeChangesOf({
    previous: args.previous,
    next: args.next,
    dialect: args.dialect,
    builtBy: args.builtBy,
  })) {
    changed.add(change.to.name);
  }
  return changed;
}

/**
 * The fields of `fields` whose values `entity` keeps per language, as the save judges them
 * (`perLanguageAfter`): none where it keeps none, whatever a field's own flag says.
 */
function translatedAsStored(
  entity: { localized?: unknown },
  fields: readonly FieldDefinition[]
): ReadonlySet<string> {
  return perLanguageAfter(entity, fields).translatedAfter ?? new Set();
}

/**
 * Whether a container's value is split otherwise between its structure, kept on the entry, and the
 * text inside it, kept per language: a field inside that joined or left translation, say.
 */
function splitOtherwise(was: FieldDefinition, now: FieldDefinition): boolean {
  return !isDeepStrictEqual(
    sharedStructureShape(was),
    sharedStructureShape(now)
  );
}
