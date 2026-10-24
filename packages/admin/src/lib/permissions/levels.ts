/**
 * The access levels the roles screen offers per collection, Single and
 * built-in resource, and how each maps to permissions.
 *
 * A level is a name for a fixed set of standard actions: No access (none),
 * Can view (read), Can edit (read, create, update, delete) and Can publish
 * (Can edit plus publish and unpublish). A Single has no create or delete, so
 * its levels leave them out. A built-in resource (media, settings, email
 * providers, email templates) has no publish, so it is offered no Can publish.
 *
 * The level is read over the standard actions alone. Any other action a
 * resource has (a plugin's `export-submissions`, a workflow step) sits under
 * the row's per-action switch, outside the level, so holding one never
 * changes what the level reads. A row whose standard actions match no level
 * reads "custom".
 *
 * Pure: the screen derives what it shows and what it saves from these two
 * functions, so the mapping is decided once.
 *
 * @module lib/permissions/levels
 */

/** A level the roles screen offers. */
export type AccessLevel = "none" | "view" | "edit" | "publish";

/** What a row reads: a level, or "custom" when its actions match none. */
export type RowLevel = AccessLevel | "custom";

/** The kinds of row whose levels differ. */
export type LevelKind = "collection" | "single" | "system";

/** A resource's permission, as far as a level needs it. */
export interface LevelPermission {
  id: string;
  action: string;
}

const CAN_EDIT = ["read", "create", "update", "delete"] as const;

/**
 * The standard actions each level grants, per kind. A kind without a level
 * does not offer it.
 */
const LEVEL_ACTIONS: Record<
  LevelKind,
  Partial<Record<AccessLevel, readonly string[]>>
> = {
  collection: {
    none: [],
    view: ["read"],
    edit: CAN_EDIT,
    publish: [...CAN_EDIT, "publish", "unpublish"],
  },
  // A Single exists once: it is never created or deleted.
  single: {
    none: [],
    view: ["read"],
    edit: ["read", "update"],
    publish: ["read", "update", "publish", "unpublish"],
  },
  // Built-in resources are never published.
  system: {
    none: [],
    view: ["read"],
    edit: CAN_EDIT,
  },
};

/** The display order of the levels, lowest first. */
const LEVEL_ORDER: readonly AccessLevel[] = ["none", "view", "edit", "publish"];

/**
 * The action a role still holds where `nextly upgrade` has not yet replaced it
 * with plain permissions. On a built-in resource it gave read, create, update
 * and delete, so it reads as Can edit rather than as nothing.
 */
const LEGACY_MANAGE = "manage";

/** The levels a row of `kind` offers, lowest first. */
export function levelsFor(kind: LevelKind): AccessLevel[] {
  return LEVEL_ORDER.filter(level => LEVEL_ACTIONS[kind][level] !== undefined);
}

/**
 * Every action the level of a row of `kind` decides: the ones a level is read
 * over, and the ones a changed level replaces.
 *
 * A built-in resource's legacy `manage` is among them. It is read as the Can
 * edit it gave, so a row moved to another level must lose it with the rest,
 * or a row set to Can view would keep editing through it. It is never saved:
 * no level's permissions include it.
 */
export function standardActions(kind: LevelKind): ReadonlySet<string> {
  const decided = new Set(
    levelsFor(kind).flatMap(level => LEVEL_ACTIONS[kind][level] ?? [])
  );
  if (kind === "system") decided.add(LEGACY_MANAGE);
  return decided;
}

/**
 * The level a row reads, from the actions the role holds on it.
 *
 * Only the standard actions count; any other is under the switch. A built-in
 * resource's legacy `manage` counts as the Can edit it gave. Actions matching
 * no level read "custom".
 */
export function levelOf(kind: LevelKind, held: Iterable<string>): RowLevel {
  const standard = standardActions(kind);
  const actions = new Set<string>();
  for (const action of held) {
    if (kind === "system" && action === LEGACY_MANAGE) {
      for (const granted of CAN_EDIT) actions.add(granted);
    } else if (standard.has(action)) {
      actions.add(action);
    }
  }
  for (const level of levelsFor(kind)) {
    const granted = LEVEL_ACTIONS[kind][level] ?? [];
    if (
      granted.length === actions.size &&
      granted.every(action => actions.has(action))
    ) {
      return level;
    }
  }
  return "custom";
}

/**
 * The ids a row of `kind` at `level` holds, from the permissions the
 * resource has.
 *
 * Only permissions that exist are returned: a level names actions, and a
 * resource missing one simply has nothing to tick for it. Actions outside the
 * level, standard or not, are not returned; the caller keeps whatever it holds
 * outside {@link standardActions}, under the switch, and replaces the rest
 * with these. A built-in resource's legacy `manage` is never returned, so a
 * row whose level changes saves plain permissions only; Can edit on one
 * therefore needs its plain create, update and delete permissions seeded.
 */
export function permissionsFor(
  kind: LevelKind,
  level: AccessLevel,
  available: readonly LevelPermission[]
): string[] {
  const granted = LEVEL_ACTIONS[kind][level];
  if (granted === undefined) {
    throw new Error(`a ${kind} row offers no "${level}" level`);
  }
  return available
    .filter(permission => granted.includes(permission.action))
    .map(permission => permission.id);
}
