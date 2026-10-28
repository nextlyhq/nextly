/**
 * Every entity's settings, as a migration snapshot records them, and what
 * changed between two records.
 *
 * "Settings" are everything stored with a collection, Single or field group
 * other than its columns: labels, description, icon, sidebar group and the
 * other admin options, versioning and Draft/Published, the localisation flag,
 * and the field settings that change no column (help text, placeholder,
 * hidden). The table diff sees none of them, so a change to one alone would
 * otherwise produce no migration and never reach a deployed database.
 *
 * The record is the entity AS DECLARED — the code-first config entry, or the
 * Builder's `ui-schema.json` entry — kept whole rather than projected onto a
 * list of known keys. A projection has to learn every option added later, and
 * each one it missed would be a setting that silently never travels. Kept
 * whole, the cost of a key that is not really a setting is a migration that
 * names it, which is visible; the cost of a missed one is production quietly
 * disagreeing with the code. The registry's own projections read the same
 * declaration, so a writer working from a snapshot derives the row from it as
 * boot derives it from the config.
 *
 * Two things are left out, because neither is stored with the entity:
 * functions (hooks, validators, conditions, computed defaults), which run in
 * the process and cannot be serialised, and code-defined `access`, which is
 * decided by code on each request. Site content settings (general settings,
 * the email setup) are not entities at all, so nothing here reads them.
 *
 * @module domains/schema/migrate-create/entity-settings
 */

/** A JSON value, as a snapshot file stores it. */
export type SettingsValue =
  | string
  | number
  | boolean
  | null
  | SettingsValue[]
  | { [key: string]: SettingsValue };

/** A JSON object, as a snapshot file stores it. */
export type SettingsObject = { [key: string]: SettingsValue };

/**
 * Where an entity is declared. A change of home is a change worth naming: the
 * registry records which surface owns a row.
 */
export type SettingsSource = "code" | "builder";

/** One entity's record: who declares it, and its declaration. */
export interface RecordedEntitySettings {
  source: SettingsSource;
  settings: SettingsObject;
}

/** The three kinds of entity a snapshot records settings for. */
export type SettingsEntityKind = "collection" | "single" | "fieldGroup";

/**
 * Every entity's settings, by kind and then by slug.
 *
 * Keyed by slug rather than listed, so the file is stable however the config
 * orders its entries; a slug is unique within its kind, and the same slug may
 * name a collection, a Single and a field group at once.
 */
export interface EntitySettingsRecord {
  collections: Record<string, RecordedEntitySettings>;
  singles: Record<string, RecordedEntitySettings>;
  fieldGroups: Record<string, RecordedEntitySettings>;
}

/** What changed in one entity's settings. */
export interface EntitySettingsChange {
  kind: SettingsEntityKind;
  slug: string;
  /**
   * Each change, as a path into the declaration: `description`,
   * `admin.group`, `fields.title.admin.placeholder`. A cleared setting reads
   * `description (cleared)`, a field `fields.excerpt (added)` or
   * `(removed)`, an entity new to the record `added`, and an entity the
   * previous snapshot predates recording settings for `settings recorded`.
   */
  changes: string[];
}

const RECORD_KEYS: Record<SettingsEntityKind, keyof EntitySettingsRecord> = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
};

const KIND_ORDER: readonly SettingsEntityKind[] = [
  "collection",
  "single",
  "fieldGroup",
];

/** Arrays whose entries are declarations of their own: fields, and blocks. */
const DECLARATION_LISTS = new Set(["fields", "blocks"]);

/** Removed, because a function or nothing serialisable was all it held. */
const DROPPED = Symbol("dropped");

/**
 * An entity's declaration as a snapshot stores it.
 *
 * Functions are dropped wherever they occur, and so is a container left empty
 * only because everything in it was a function: `hooks: { beforeChange: [fn] }`
 * says nothing a snapshot can hold, and keeping it as `{}` would make adding
 * or removing a hook read as a settings change. `access` is dropped on the
 * entity and on every field and block it declares. Keys are kept as written;
 * the snapshot writer sorts them.
 */
export function settingsOf(declaration: unknown): SettingsObject {
  const value = normalize(declaration, true, new Set());
  return value !== DROPPED &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : {};
}

function normalize(
  value: unknown,
  isDeclaration: boolean,
  path: Set<object>
): SettingsValue | typeof DROPPED {
  if (value === null || typeof value !== "object")
    return normalizeScalar(value);
  if (value instanceof Date) return value.toISOString();
  // A reference back to an object on the current path has no JSON form.
  if (path.has(value)) return DROPPED;
  path.add(value);
  try {
    return Array.isArray(value)
      ? normalizeList(value, isDeclaration, path)
      : normalizeObject(value as Record<string, unknown>, isDeclaration, path);
  } finally {
    path.delete(value);
  }
}

/** A value that is not an object, as JSON can hold it, or dropped. */
function normalizeScalar(value: unknown): SettingsValue | typeof DROPPED {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "object":
      return null;
    default:
      // undefined, a function or a symbol: nothing a snapshot can hold.
      return DROPPED;
  }
}

function normalizeList(
  value: readonly unknown[],
  isDeclaration: boolean,
  path: Set<object>
): SettingsValue[] | typeof DROPPED {
  const items = value
    .map(item => normalize(item, isDeclaration, path))
    .filter((item): item is SettingsValue => item !== DROPPED);
  return items.length === 0 && value.length > 0 ? DROPPED : items;
}

function normalizeObject(
  value: Record<string, unknown>,
  isDeclaration: boolean,
  path: Set<object>
): SettingsObject | typeof DROPPED {
  const out: SettingsObject = {};
  let dropped = 0;
  for (const [key, child] of Object.entries(value)) {
    if (isDeclaration && key === "access") continue;
    const normalized = normalize(
      child,
      DECLARATION_LISTS.has(key) && Array.isArray(child),
      path
    );
    if (normalized === DROPPED) dropped += 1;
    else out[key] = normalized;
  }
  return Object.keys(out).length === 0 && dropped > 0 ? DROPPED : out;
}

/** An empty record: the state before any entity existed. */
function emptySettingsRecord(): EntitySettingsRecord {
  return { collections: {}, singles: {}, fieldGroups: {} };
}

/** An entity as the generator holds it, with its recorded settings if known. */
export interface EntityWithSettings {
  slug: string;
  settings?: RecordedEntitySettings;
}

/**
 * The record for the entities a migration is generated from.
 *
 * An entity handed in without its declaration contributes nothing, and a set
 * in which none carries one yields no record at all, which a later run reads
 * as a snapshot that says nothing about settings — never as settings cleared.
 */
export function settingsRecordOf(entities: {
  collections: readonly EntityWithSettings[];
  singles: readonly EntityWithSettings[];
  components: readonly EntityWithSettings[];
}): EntitySettingsRecord | undefined {
  const record = emptySettingsRecord();
  let any = false;
  const add = (
    list: readonly EntityWithSettings[],
    into: Record<string, RecordedEntitySettings>
  ) => {
    for (const entity of list) {
      if (entity.settings === undefined) continue;
      into[entity.slug] = entity.settings;
      any = true;
    }
  };
  add(entities.collections, record.collections);
  add(entities.singles, record.singles);
  add(entities.components, record.fieldGroups);
  return any ? record : undefined;
}

/**
 * What changed from `previous` to `desired`, entity by entity, in a stable
 * order: collections, then Singles, then field groups, each by slug.
 *
 * `previous` is `null` when there is no earlier snapshot at all, so every
 * entity is new, and `undefined` when the earlier snapshot predates recording
 * settings: it says nothing about them, so every entity's settings are named
 * as recorded for the first time rather than as changed.
 *
 * `declared` is which slugs each kind declares now. An entity the previous
 * record holds and the config no longer declares is named `removed`; one the
 * config still declares but whose settings are not known this run is left
 * alone rather than read as gone.
 */
export function settingsChanges(
  previous: EntitySettingsRecord | null | undefined,
  desired: EntitySettingsRecord | undefined,
  declared: Record<SettingsEntityKind, ReadonlySet<string>>
): EntitySettingsChange[] {
  if (desired === undefined) return [];
  const changes: EntitySettingsChange[] = [];
  for (const kind of KIND_ORDER) {
    const key = RECORD_KEYS[kind];
    const before = previous?.[key] ?? {};
    const after = desired[key];
    const slugs = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    for (const slug of slugs) {
      const found = entityChanges(
        before[slug],
        after[slug],
        previous !== undefined,
        declared[kind].has(slug)
      );
      if (found.length > 0) changes.push({ kind, slug, changes: found });
    }
  }
  return changes;
}

/** One entity's changes; see `settingsChanges` for what each word means. */
function entityChanges(
  was: RecordedEntitySettings | undefined,
  now: RecordedEntitySettings | undefined,
  previousKnown: boolean,
  declaredNow: boolean
): string[] {
  if (now === undefined) return declaredNow ? [] : ["removed"];
  if (!previousKnown) return ["settings recorded"];
  if (was === undefined) return ["added"];
  return [
    ...(was.source !== now.source ? ["source"] : []),
    ...diffSettings(was.settings, now.settings, ""),
  ];
}

/** `posts: description, admin.group`, with the kind named for a non-collection. */
export function describeSettingsChange(change: EntitySettingsChange): string {
  const who =
    change.kind === "collection"
      ? change.slug
      : `${change.slug} (${change.kind === "single" ? "single" : "field group"})`;
  return `${who}: ${change.changes.join(", ")}`;
}

function joinPath(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function isObject(value: SettingsValue | undefined): value is SettingsObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameValue(a: SettingsValue, b: SettingsValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameValue(item, b[i]))
    );
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(key => key in b && sameValue(a[key], b[key]))
    );
  }
  return false;
}

/**
 * The key a list of declarations is matched by, when every entry has one:
 * `name` for fields, `slug` for blocks. Null for any other list, which is
 * compared whole.
 */
function identityKey(list: readonly SettingsValue[]): "name" | "slug" | null {
  for (const key of ["name", "slug"] as const) {
    if (
      list.length > 0 &&
      list.every(item => isObject(item) && typeof item[key] === "string")
    ) {
      return key;
    }
  }
  return null;
}

function diffSettings(
  before: SettingsValue,
  after: SettingsValue,
  path: string
): string[] {
  if (sameValue(before, after)) return [];
  if (isObject(before) && isObject(after)) {
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    return keys.flatMap(key => {
      const where = joinPath(path, key);
      // An object set or cleared whole is named by what it holds, so a field
      // gaining its first admin option reads `admin.placeholder`, not `admin`.
      if (!(key in after)) {
        return isObject(before[key]) && Object.keys(before[key]).length > 0
          ? diffSettings(before[key], {}, where)
          : [`${where} (cleared)`];
      }
      if (!(key in before)) {
        return isObject(after[key]) && Object.keys(after[key]).length > 0
          ? diffSettings({}, after[key], where)
          : [where];
      }
      return diffSettings(before[key], after[key], where);
    });
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // Matched by name only when both sides are such lists; an empty side
    // takes the other's key, so a first field reads as added.
    const id = identityKey([...before, ...after]);
    if (id !== null) return diffDeclarationList(before, after, id, path);
  }
  return [path === "" ? "settings" : path];
}

/** Fields (or blocks) matched by name: each one added, removed, changed, and the order. */
function diffDeclarationList(
  before: readonly SettingsValue[],
  after: readonly SettingsValue[],
  id: "name" | "slug",
  path: string
): string[] {
  const keyOf = (item: SettingsValue) => (item as SettingsObject)[id] as string;
  const was = new Map(before.map(item => [keyOf(item), item]));
  const now = new Map(after.map(item => [keyOf(item), item]));
  const out: string[] = [];
  for (const item of after) {
    const name = keyOf(item);
    const where = joinPath(path, name);
    const previous = was.get(name);
    if (previous === undefined) out.push(`${where} (added)`);
    else out.push(...diffSettings(previous, item, where));
  }
  for (const item of before) {
    const name = keyOf(item);
    if (!now.has(name)) out.push(`${joinPath(path, name)} (removed)`);
  }
  const keptBefore = before.map(keyOf).filter(name => now.has(name));
  const keptAfter = after.map(keyOf).filter(name => was.has(name));
  if (keptBefore.some((name, i) => keptAfter[i] !== name)) {
    out.push(`${path} (order)`);
  }
  return out;
}

/** Structural check of a snapshot file's `entities`, for the snapshot reader. */
export function isEntitySettingsRecord(
  value: unknown
): value is EntitySettingsRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Object.values(RECORD_KEYS).every(key => {
    const byslug = record[key];
    if (byslug === null || typeof byslug !== "object" || Array.isArray(byslug))
      return false;
    return Object.values(byslug).every(entry => {
      if (entry === null || typeof entry !== "object") return false;
      const { source, settings } = entry as Record<string, unknown>;
      return (
        (source === "code" || source === "builder") &&
        settings !== null &&
        typeof settings === "object" &&
        !Array.isArray(settings)
      );
    });
  });
}
