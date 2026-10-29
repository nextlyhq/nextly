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
  MANAGE_BRIDGE_RESOURCES,
  permissionsFor,
  standardActions,
  type AccessLevel,
  type LevelKind,
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

/**
 * One collection, Single or built-in resource (media, settings, the Email
 * hub's providers and templates) as the roles screen shows it.
 */
export interface LevelRow {
  slug: string;
  kind: LevelKind;
  /** The name the row is shown by: the entity's singular label. */
  label: string;
  /** The entity's plural label, or its singular where it has none. */
  plural: string;
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
    plural: entity.labels.plural ?? entity.labels.singular,
    plugin: entity.plugin,
    declaredRules: entity.declaredRules,
    permissions: bySlug.get(entity.slug) ?? [],
  }));
  return { rows, rest };
}

/**
 * What each built-in resource with a level row is called. Its slugs are the
 * ones whose earlier `manage-` permission stood for the plain four, so a row
 * reads that permission as the Can edit it gave.
 */
const SYSTEM_ROW_LABELS: Readonly<Record<string, string>> = {
  media: "Media",
  settings: "Settings",
  "email-providers": "Email providers",
  "email-templates": "Email templates",
};

/**
 * The rows for the built-in resources a role is given a level on, in a fixed
 * order, and the permissions none of them takes. A resource with no
 * permission listed gets no row.
 */
export function systemLevelRows(permissions: readonly Permission[]): {
  rows: LevelRow[];
  rest: Permission[];
} {
  const bySlug = new Map<string, Permission[]>(
    [...MANAGE_BRIDGE_RESOURCES].map(slug => [slug, []])
  );
  const rest: Permission[] = [];
  for (const permission of permissions) {
    const own = bySlug.get(permission.resource);
    if (own) own.push(permission);
    else rest.push(permission);
  }
  const rows: LevelRow[] = [];
  for (const [slug, own] of bySlug) {
    if (own.length === 0) continue;
    const label = SYSTEM_ROW_LABELS[slug] ?? slug;
    rows.push({
      slug,
      kind: "system",
      label,
      plural: label,
      plugin: null,
      declaredRules: [],
      permissions: own,
    });
  }
  return { rows, rest };
}

/**
 * Every row and group the roles screen shows, from the entities and
 * permissions it loads, each permission in exactly one place.
 *
 * The built-in resources are taken first. A collection or Single created
 * before its name was reserved for one (`settings`, `media`) keeps that name,
 * and its permissions are the built-in resource's own permissions, so it is
 * shown as the built-in row rather than as a collection; any action of its
 * own that no level holds, such as `publish`, sits under that row's switch.
 */
export function roleScreenRows(
  entities: readonly ScreenEntity[],
  permissions: readonly Permission[]
): { appRows: LevelRow[]; groups: PluginGroup[]; rest: Permission[] } {
  const system = systemLevelRows(permissions);
  const built = levelRows(
    entities.filter(entity => !MANAGE_BRIDGE_RESOURCES.has(entity.slug)),
    system.rest
  );
  const sorted = pluginGroups(built.rows, built.rest);
  return { ...sorted, appRows: [...sorted.appRows, ...system.rows] };
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

/** The schema routes ask all three of these settings actions together. */
const SCHEMA_CHANGE_ACTIONS = ["create", "update", "delete"] as const;

/**
 * The lines a row shows under its name, from what `ids` hold on it.
 *
 * - A built-in resource whose role still holds its retired `manage-`
 *   permission reads Can edit, which that permission gives until `nextly
 *   upgrade` converts it into the plain four. Saving the role stores the same
 *   access as plain permissions unless the row is changed. Where the role
 *   holds it only through a base role (`ownIds` lacks it), saving this role
 *   leaves it on the base role, so the note says where it comes from instead.
 * - Settings says that changing collections and Singles needs Can edit on it,
 *   since the schema routes ask create, update and delete on settings
 *   together; a role holding update without the other two is told it can
 *   change settings but not the schema.
 */
export function rowNotes(
  row: LevelRow,
  ids: Iterable<string>,
  ownIds: Iterable<string>
): string[] {
  if (row.kind !== "system") return [];
  const held = new Set(actionsHeld(row, ids));
  const notes: string[] = [];
  if (held.has("manage")) {
    notes.push(
      new Set(actionsHeld(row, ownIds)).has("manage")
        ? `This role still holds the retired manage-${row.slug} permission, ` +
            "which gives Can edit. Run nextly upgrade to convert it into the " +
            "plain permissions; saving this role converts it too."
        : `This role inherits the retired manage-${row.slug} permission ` +
            "from a base role, which gives Can edit. Run nextly upgrade, or " +
            "save the base role, to convert it into the plain permissions."
    );
  }
  if (row.slug === "settings") {
    notes.push(
      "Changing collections and Singles needs Can edit on Settings " +
        "(create, update and delete)."
    );
    const schema =
      held.has("manage") || SCHEMA_CHANGE_ACTIONS.every(a => held.has(a));
    if (held.has("update") && !schema) {
      notes.push("Can change settings, but not collections or Singles.");
    }
  }
  return notes;
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
 * {@link withLevel} for a role whose list holds only its own permissions, a
 * base role's being shown beside them and never saved as the role's: `own`
 * with `row` set to `level`, read together with `lockedIds` and returned
 * without them.
 *
 * The row's standard actions become exactly what the level needs beyond the
 * base, so the role's own copy of one the base also gives is dropped: the
 * level then rests on the base, and changing the base later changes it. A
 * copy outside what the level decides (another row's, or an action under the
 * row's switch) stays the role's own.
 */
export function ownWithLevel(
  own: readonly string[],
  row: LevelRow,
  level: AccessLevel,
  lockedIds: readonly string[] = []
): string[] {
  const owned = new Set(own);
  const locked = new Set(lockedIds);
  const decided = standardActions(row.kind, row.slug);
  const levelDecides = new Set(
    row.permissions
      .filter(permission => decided.has(permission.action))
      .map(permission => permission.id)
  );
  const inherited = lockedIds.filter(id => !owned.has(id));
  return withLevel([...own, ...inherited], row, level, lockedIds).filter(
    id => !locked.has(id) || (owned.has(id) && !levelDecides.has(id))
  );
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

/**
 * The owner the server records for a permission the app itself declares, as
 * opposed to a plugin. Such a permission belongs to no plugin's group. A
 * plugin may be named the same, and its loose permissions then stay in the
 * grid beside the app's: never put in a group that is not theirs.
 */
const APP_OWNER = "app";

/**
 * One plugin on the roles screen: the collections and Singles it contributes,
 * and the permissions it declares that no row takes (an action of its own,
 * such as exporting submissions).
 */
export interface PluginGroup {
  /** The plugin's package name, as the server names it. */
  plugin: string;
  rows: LevelRow[];
  /** Permissions the plugin declares (`owner`) that belong to no row. */
  permissions: Permission[];
}

/**
 * The rows and loose permissions sorted for the screen: the app's own rows,
 * one group per plugin, and what is left for the grid.
 *
 * A row goes to the plugin the server says contributes its entity; a loose
 * permission to the plugin that declared it. A plugin that declares
 * permissions but contributes no collection still gets a group, so none of
 * its permissions is left out. Groups come in the order their plugin is first
 * met, rows before loose permissions.
 */
export function pluginGroups(
  rows: readonly LevelRow[],
  rest: readonly Permission[]
): { appRows: LevelRow[]; groups: PluginGroup[]; rest: Permission[] } {
  const groups = new Map<string, PluginGroup>();
  const groupOf = (plugin: string): PluginGroup => {
    const found = groups.get(plugin);
    if (found) return found;
    const created: PluginGroup = { plugin, rows: [], permissions: [] };
    groups.set(plugin, created);
    return created;
  };
  const appRows: LevelRow[] = [];
  for (const row of rows) {
    if (row.plugin === null) appRows.push(row);
    else groupOf(row.plugin).rows.push(row);
  }
  const left: Permission[] = [];
  for (const permission of rest) {
    if (permission.owner && permission.owner !== APP_OWNER)
      groupOf(permission.owner).permissions.push(permission);
    else left.push(permission);
  }
  return { appRows, groups: [...groups.values()], rest: left };
}

/**
 * The one level a plugin's group reads, for its summary: the level every row
 * reads, where none of the plugin's own permissions is held beside it; else
 * "custom". A group with no rows reads No access until one of its own
 * permissions is held.
 */
export function groupLevel(
  group: PluginGroup,
  ids: Iterable<string>
): RowLevel {
  const held = new Set(ids);
  // The plugin's own permissions: its loose ones, and the actions it declares
  // on its own collections outside what a level decides, which the rows hold
  // under their switches and a level never reads.
  const own = [
    ...group.permissions,
    ...group.rows.flatMap(row => {
      const decided = standardActions(row.kind, row.slug);
      return row.permissions.filter(
        permission =>
          permission.owner === group.plugin && !decided.has(permission.action)
      );
    }),
  ];
  const ownHeld = own.some(permission => held.has(permission.id));
  const levels = new Set(group.rows.map(row => rowLevel(row, held)));
  if (levels.size === 0) return ownHeld ? "custom" : "none";
  if (levels.size > 1 || ownHeld) return "custom";
  const [level] = levels;
  return level;
}
