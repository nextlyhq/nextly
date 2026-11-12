/**
 * What the applied migrations' snapshots, read in run order, say changed in
 * the registry: the entities a migration dropped, the settings a migration
 * cleared from a Builder entity, the entities whose field types a migration
 * changed, and the entities a migration added.
 *
 * Each is judged only between snapshots that record every entity's
 * declaration (`SnapshotFile.entities`). An earlier release's snapshot
 * records none, and says nothing about them: it is never read as an entity
 * dropped or a setting cleared.
 *
 * Pure: the snapshots are read by `registry-source.ts` and the rollback's
 * planner; what is done with the answers is the registry writer's.
 *
 * @module domains/schema/migrate/registry-history
 */
import type { UnsaidSetting } from "../../collections/services/collection-registry-service";
import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
  SettingsEntityKind,
} from "../migrate-create/entity-settings";

/** Slugs by kind of entity. */
export type SlugsByKind = Record<SettingsEntityKind, Set<string>>;

/** The key each kind's entities are recorded under in a snapshot. */
export const RECORDED_KINDS = [
  ["collection", "collections"],
  ["single", "singles"],
  ["fieldGroup", "fieldGroups"],
] as const satisfies ReadonlyArray<
  readonly [SettingsEntityKind, keyof EntitySettingsRecord]
>;

/** No slug of any kind. */
export function noSlugs(): SlugsByKind {
  return { collection: new Set(), single: new Set(), fieldGroup: new Set() };
}

/**
 * The entities an applied migration dropped, that the newest record no
 * longer holds: an entity a record held and the next record in `chain` no
 * longer holds. `chain` is the applied records in run order, oldest first,
 * each the one after the other with no snapshot between them that records
 * nothing; its last is the newest. An entity dropped and later recorded
 * again is not dropped.
 */
export function droppedEntities(
  chain: readonly EntitySettingsRecord[]
): SlugsByKind {
  const dropped = noSlugs();
  const newest = chain.at(-1);
  if (newest === undefined) return dropped;
  for (let at = 1; at < chain.length; at += 1) {
    const [before, after] = [chain[at - 1], chain[at]];
    for (const [kind, key] of RECORDED_KINDS) {
      for (const slug of Object.keys(before[key])) {
        if (!(slug in after[key]) && !(slug in newest[key])) {
          dropped[kind].add(slug);
        }
      }
    }
  }
  return dropped;
}

/**
 * The entities `added` records that `point` does not hold: what a rollback
 * from the migrations that wrote `added` back to `point` removes, since one
 * of them added each.
 */
export function addedEntities(
  added: readonly EntitySettingsRecord[],
  point: EntitySettingsRecord
): SlugsByKind {
  const slugs = noSlugs();
  for (const record of added) {
    for (const [kind, key] of RECORDED_KINDS) {
      for (const slug of Object.keys(record[key])) {
        if (!(slug in point[key])) slugs[kind].add(slug);
      }
    }
  }
  return slugs;
}

/** The settings a Builder record may leave unsaid, as its declaration keys them. */
const UNSAID: readonly UnsaidSetting[] = ["description", "admin"];

/**
 * Of the settings each Builder entity in `target` leaves unsaid, those a
 * migration cleared: a record of the same entity in `others` (the records
 * the database stood at before, in any order) said it. A setting no record
 * ever said is not cleared, so a value stored by other means stays. Keyed
 * `<kind>:<slug>`; an entity with nothing cleared is left out.
 */
export function clearedSettings(
  target: EntitySettingsRecord,
  others: readonly EntitySettingsRecord[]
): Map<string, Set<UnsaidSetting>> {
  const cleared = new Map<string, Set<UnsaidSetting>>();
  for (const [kind, key] of RECORDED_KINDS) {
    for (const [slug, recorded] of Object.entries(target[key])) {
      if (recorded.source !== "builder") continue;
      const unsaid = UNSAID.filter(
        setting =>
          !says(recorded, setting) &&
          others.some(other => {
            const earlier = other[key][slug];
            return earlier !== undefined && says(earlier, setting);
          })
      );
      if (unsaid.length > 0) cleared.set(`${kind}:${slug}`, new Set(unsaid));
    }
  }
  return cleared;
}

/** Whether a recorded declaration says `setting`: present and not null. */
function says(recorded: RecordedEntitySettings, setting: UnsaidSetting) {
  const value = recorded.settings[setting];
  return value !== undefined && value !== null;
}

/**
 * The entities both records hold whose fields' types differ between them: a
 * field, at any depth and named by its path, that has one type in `before`
 * and another in `after`. A field only one of them holds is not a type
 * change.
 */
export function typeChangedEntities(
  before: EntitySettingsRecord,
  after: EntitySettingsRecord
): SlugsByKind {
  const changed = noSlugs();
  for (const [kind, key] of RECORDED_KINDS) {
    for (const [slug, recorded] of Object.entries(after[key])) {
      const earlier = before[key][slug];
      if (earlier === undefined) continue;
      const was = fieldTypes(earlier.settings.fields);
      for (const [path, type] of fieldTypes(recorded.settings.fields)) {
        if (was.has(path) && was.get(path) !== type) {
          changed[kind].add(slug);
          break;
        }
      }
    }
  }
  return changed;
}

/** Each named field's type by its path, nested fields and block fields included. */
function fieldTypes(fields: unknown, prefix = ""): Map<string, unknown> {
  const types = new Map<string, unknown>();
  if (!Array.isArray(fields)) return types;
  for (const field of fields as unknown[]) {
    if (field === null || typeof field !== "object") continue;
    const {
      name,
      type,
      fields: nested,
      blocks,
    } = field as Record<string, unknown>;
    const path = typeof name === "string" ? `${prefix}${name}` : prefix;
    if (typeof name === "string") types.set(path, type);
    for (const [inner, innerType] of fieldTypes(nested, `${path}.`)) {
      types.set(inner, innerType);
    }
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks as unknown[]) {
      if (block === null || typeof block !== "object") continue;
      const { slug, fields: inBlock } = block as Record<string, unknown>;
      for (const [inner, innerType] of fieldTypes(
        inBlock,
        `${path}.${String(slug)}.`
      )) {
        types.set(inner, innerType);
      }
    }
  }
  return types;
}

/** Whether any kind holds a slug. */
export function anySlugs(slugs: SlugsByKind): boolean {
  return RECORDED_KINDS.some(([kind]) => slugs[kind].size > 0);
}
