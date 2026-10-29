/**
 * The roles screen's rows: one per collection and Single, each read at a
 * level and changed by setting one.
 *
 * Built from what `GET /roles/screen` lists (each entity's kind, label,
 * plugin and declared rules) and from `GET /permissions` (every permission
 * the role can hold). A row takes every permission whose resource is its
 * slug; a permission no row takes stays outside, for the screen's other
 * sections, so each permission is shown in exactly one place.
 *
 * A row's level is read with `levelOf` and set with `permissionsFor`
 * (`./levels`), so the mapping between levels and actions is decided there
 * and only there. What this module adds is the row: which ids belong to it,
 * and how setting its level changes the role's whole permission list without
 * touching anything the level does not decide.
 *
 * Pure: no fetching and no React, so the screen and its tests derive from
 * the same functions.
 *
 * @module lib/permissions/level-rows
 */

import { z } from "zod";

import type { Permission } from "../../types/ui/form";

import {
  levelOf,
  levelsFor,
  permissionsFor,
  standardActions,
  type AccessLevel,
  type RowLevel,
} from "./levels";

/**
 * One entity of `GET /roles/screen`, parsed at the boundary: a list the
 * server answers in another shape is refused rather than read as rows with
 * no label or kind.
 */
const screenEntitySchema = z.object({
  slug: z.string().min(1),
  kind: z.enum(["collection", "single"]),
  labels: z.object({
    singular: z.string(),
    plural: z.string().optional(),
  }),
  plugin: z.string().nullable(),
  declaredRules: z.array(z.string()),
});

const screenListSchema = z.object({ items: z.array(screenEntitySchema) });

/** One collection or Single, as `GET /roles/screen` lists it. */
export type ScreenEntity = z.infer<typeof screenEntitySchema>;

/** The entities in a `GET /roles/screen` response body; throws on any other shape. */
export function screenEntitiesFrom(body: unknown): ScreenEntity[] {
  return screenListSchema.parse(body).items;
}

/** One collection or Single as the roles screen shows it. */
export interface LevelRow {
  slug: string;
  kind: ScreenEntity["kind"];
  /** The name the row is shown by: the entity's singular label. */
  label: string;
  /** The plugin that contributes the entity, or null for the app's own. */
  plugin: string | null;
  /** The operations whose code declares a rule for the entity. */
  declaredRules: readonly string[];
  /** Every permission whose resource is the entity's slug. */
  permissions: readonly Permission[];
}

/**
 * The rows for `entities`, in the order the server lists them, and the
 * permissions no row takes.
 */
export function levelRows(
  entities: readonly ScreenEntity[],
  permissions: readonly Permission[]
): { rows: LevelRow[]; rest: Permission[] } {
  const bySlug = new Map<string, Permission[]>(
    entities.map(entity => [entity.slug, []])
  );
  const rest: Permission[] = [];
  for (const permission of permissions) {
    const own = bySlug.get(permission.resource);
    if (own) own.push(permission);
    else rest.push(permission);
  }
  const rows = entities.map(entity => ({
    slug: entity.slug,
    kind: entity.kind,
    label: entity.labels.singular,
    plugin: entity.plugin,
    declaredRules: entity.declaredRules,
    permissions: bySlug.get(entity.slug) ?? [],
  }));
  return { rows, rest };
}

/** The actions `ids` hold on `row`; an id of another row is not counted. */
function actionsHeld(row: LevelRow, ids: Iterable<string>): string[] {
  const held = new Set(ids);
  return row.permissions
    .filter(permission => held.has(permission.id))
    .map(permission => permission.action);
}

/** The level `ids` give `row`, or "custom" where they match none. */
export function rowLevel(row: LevelRow, ids: Iterable<string>): RowLevel {
  return levelOf(row.kind, actionsHeld(row, ids), row.slug);
}

/**
 * The role's permission list with `row` set to `level`.
 *
 * Only the row's standard actions change: they become exactly the level's.
 * Every other row's ids, the row's actions outside the level (under its
 * switch), and the ids in `lockedIds` (given by a base role, which the role
 * cannot take away) are kept as they are.
 */
export function withLevel(
  value: readonly string[],
  row: LevelRow,
  level: AccessLevel,
  lockedIds: readonly string[] = []
): string[] {
  const decided = standardActions(row.kind, row.slug);
  const locked = new Set(lockedIds);
  const replaced = new Set(
    row.permissions
      .filter(
        permission =>
          decided.has(permission.action) && !locked.has(permission.id)
      )
      .map(permission => permission.id)
  );
  const kept = value.filter(id => !replaced.has(id));
  const keptSet = new Set(kept);
  const given = permissionsFor(row.kind, level, row.permissions);
  return [...kept, ...given.filter(id => !keptSet.has(id))];
}

/**
 * The levels `row` offers a role whose base roles give it `lockedIds`.
 *
 * A level is offered when setting it keeps the row at that level: one whose
 * permissions hold every standard action the base gives. So a base giving
 * Can view takes No access away, and a base giving an action set that is no
 * level (read and update on a collection) leaves only the levels above it.
 */
export function offeredLevels(
  row: LevelRow,
  lockedIds: readonly string[] = []
): AccessLevel[] {
  return levelsFor(row.kind).filter(
    level =>
      rowLevel(row, withLevel(lockedIds, row, level, lockedIds)) === level
  );
}
