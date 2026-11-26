/**
 * A code-first reload's fields that look moved into or out of a group, held back before the reload
 * assembles its apply. The development push compares columns, so a field moved into a group reads
 * as a column to delete, values and all, and one moved out as an empty column to add while its
 * values stay in the group, where nothing reads them. No consent makes either the move it is, so
 * each entity holding such a field is held back whole, as a type change needing review is, with
 * the way to carry it: `nextly migrate:create`, which asks whether each is a move and copies its
 * values, then `nextly migrate`. Every other entity's change still applies.
 *
 * A field of the same name and type that left one place and arrived in another may also be one
 * deleted and another added; `migrate:create` is where that is answered, since a reload, which runs
 * inside the development server, asks nobody.
 *
 * @module init/code-first-moves
 */
import { definitionRefusal } from "../domains/schema/field-moves/check-move";
import { moveCandidates } from "../domains/schema/field-moves/move-candidates";
import type { FieldDefinition } from "../schemas/dynamic-collections";

import type { HeldBackTypeChange } from "./code-first-type-changes";

/** One entity the reload would push, with the fields its registry row recorded before it. */
export interface ReloadedEntity {
  kind: HeldBackTypeChange["kind"];
  slug: string;
  fields: readonly unknown[];
  /** Absent for an entity the registry did not hold: one new to the configuration. */
  recordedFields?: readonly unknown[];
}

/** The entities of `entities` holding a field that looks moved, each with its reasons. */
export function movesHeldBack(
  entities: readonly ReloadedEntity[]
): HeldBackTypeChange[] {
  return entities.flatMap(entity => {
    if (entity.recordedFields === undefined) return [];
    const moves = moveCandidates(
      entity.recordedFields as FieldDefinition[],
      entity.fields as FieldDefinition[]
    );
    if (moves.length === 0) return [];
    return [
      {
        kind: entity.kind,
        slug: entity.slug,
        reasons: moves.map(({ from, to }) => {
          const was = from.join(".");
          const now = to.join(".");
          // A move that can never be made as it is (a field kept unique into a group) is told so,
          // in the words the Schema Builder and migrate:create refuse it in: told instead to run
          // migrate:create, it would be refused there. What the push cannot answer, such as who
          // uses a field group, keeps its own words.
          const refused = definitionRefusal(
            entity.recordedFields as FieldDefinition[],
            entity.fields as FieldDefinition[],
            { from, to }
          );
          if (refused !== undefined) {
            return `${refused} The change was not applied.`;
          }
          // Onto the row, into a group, or between groups, whose JSON alone changes.
          const lost =
            to.length === 1
              ? `add ${now} empty, leaving its values in the group`
              : from.length === 1
                ? `delete ${was} with its values`
                : `start ${now} empty, leaving its values at ${was}, where nothing reads them`;
          return `${was} looks moved to ${now}, and the development push would ${lost}. Run nextly migrate:create, which asks whether it is a move and copies its values, then nextly migrate.`;
        }),
      },
    ];
  });
}

/** The entities of one kind the reload would push, as `movesHeldBack` reads them. */
export function reloadedEntities(
  kind: ReloadedEntity["kind"],
  entries: Readonly<
    Record<
      string,
      {
        slug: string;
        fields: readonly unknown[];
        recordedFields?: readonly unknown[];
      }
    >
  >
): ReloadedEntity[] {
  return Object.values(entries).map(entry => ({
    kind,
    slug: entry.slug,
    fields: entry.fields,
    ...(entry.recordedFields === undefined
      ? {}
      : { recordedFields: entry.recordedFields }),
  }));
}

/**
 * `held` with each entity `moves` holds back: an entity both lists hold keeps one entry, its
 * type change's reasons first, so the reload names it once.
 */
export function withMovesHeldBack(
  held: readonly HeldBackTypeChange[],
  moves: readonly HeldBackTypeChange[]
): HeldBackTypeChange[] {
  const key = (entry: HeldBackTypeChange) => `${entry.kind}:${entry.slug}`;
  const merged = new Map(held.map(entry => [key(entry), { ...entry }]));
  for (const entry of moves) {
    const already = merged.get(key(entry));
    if (already === undefined) merged.set(key(entry), { ...entry });
    else already.reasons = [...already.reasons, ...entry.reasons];
  }
  return [...merged.values()];
}
