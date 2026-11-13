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
import { canonicalJson } from "../../../shared/lib/canonical-json";
import type { UnsaidSetting } from "../../collections/services/collection-registry-service";
import {
  settingsChangesFor,
  type EntitySettingsRecord,
  type RecordedEntitySettings,
  type SettingsEntityKind,
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

/**
 * The entities `undone` (the records of the migrations a rollback undoes)
 * changed from `point` (the record it returns to): one whose record in any
 * of them differs from the point's, or that one of them holds and the point
 * does not, or the other way round. A rollback writes these rows and no
 * other, so a row nothing it undoes touched keeps what it holds.
 */
export function touchedEntities(
  undone: readonly EntitySettingsRecord[],
  point: EntitySettingsRecord
): SlugsByKind {
  const touched = noSlugs();
  for (const record of undone) {
    for (const [kind, key] of RECORDED_KINDS) {
      const slugs = new Set([
        ...Object.keys(record[key]),
        ...Object.keys(point[key]),
      ]);
      for (const slug of slugs) {
        const [was, now] = [point[key][slug], record[key][slug]];
        if (canonicalJson(was ?? null) !== canonicalJson(now ?? null)) {
          touched[kind].add(slug);
        }
      }
    }
  }
  return touched;
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
 * The keys of a field that change nothing about its column: what the admin
 * shows and the editor offers. A change to any other key of a field (its
 * type, `hasMany`, `relationTo`, `required`, `dbType`, `options`, `virtual`
 * and whatever is added later) may change how it is stored, so it is taken
 * for one: writing that row with its file costs nothing where it was not.
 */
const SETTINGS_ONLY = new Set([
  "admin",
  "custom",
  "label",
  "labels",
  "description",
  "components",
  "filterOptions",
  "defaultValue",
]);

/**
 * Whether a change `settingsChangesFor` names (`fields.points.type`,
 * `fields.cta.fields.count.admin.placeholder`, `fields.body.blocks.hero.fields.x.type`)
 * may change a field's column. A field added, removed or reordered is not
 * one: its row is written at the run's end like any other. A field list it
 * could not match field by field (`fields`) may hide one.
 */
function changesColumn(change: string): boolean {
  if (/ \((added|removed|order)\)$/.test(change)) return false;
  const parts = change.replace(/ \(cleared\)$/, "").split(".");
  if (parts[0] !== "fields") return false;
  // `parts[at]` is a `fields` key, `parts[at + 1]` a field's name and
  // `parts[at + 2]` the key of that field that changed.
  let at = 0;
  for (;;) {
    const key = parts[at + 2];
    if (parts[at + 1] === undefined || key === undefined) return true;
    if (key === "fields") {
      at += 2;
      continue;
    }
    if (key === "blocks" && parts[at + 4] === "fields") {
      at += 4;
      continue;
    }
    return !SETTINGS_ONLY.has(key);
  }
}

/**
 * The entities both records hold whose fields' column shapes may differ
 * between them (`changesColumn`), read from the one diff of two records that
 * `migrate:create` writes a migration for. A field only one of them holds is
 * not a type change: its row is written at the run's end like any other.
 */
export function typeChangedEntities(
  before: EntitySettingsRecord,
  after: EntitySettingsRecord
): SlugsByKind {
  const changed = noSlugs();
  const listed = (key: keyof EntitySettingsRecord) =>
    Object.entries(after[key])
      .filter(([slug]) => slug in before[key])
      .map(([slug, settings]) => ({ slug, settings }));
  const changes = settingsChangesFor(
    {
      collections: listed("collections"),
      singles: listed("singles"),
      components: listed("fieldGroups"),
    },
    before
  );
  for (const change of changes) {
    if (change.changes.some(changesColumn)) {
      changed[change.kind].add(change.slug);
    }
  }
  return changed;
}

/** Whether any kind holds a slug. */
export function anySlugs(slugs: SlugsByKind): boolean {
  return RECORDED_KINDS.some(([kind]) => slugs[kind].size > 0);
}
