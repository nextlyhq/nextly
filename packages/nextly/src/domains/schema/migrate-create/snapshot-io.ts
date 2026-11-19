// F11 PR 3: snapshot file I/O for `migrate:create` and `migrate:check`.
//
// Each migration ships with a paired snapshot file capturing the schema
// state AFTER the migration is applied. The next `migrate:create` reads
// the latest snapshot to know "where the schema is now", diffs against
// the new desired schema, and emits ALTER statements for the difference.
//
// On-disk format (per spec §8.1) — superset of NextlySchemaSnapshot:
//
//   {
//     "version": 1,
//     "migrationHash": "<sha256 of paired .sql file content>",
//     "snapshot": { "tables": [ ... ] },
//     "entities": { "collections": {...}, "singles": {...}, "fieldGroups": {...} },
//     "permissions": { "app": {...}, "plugins": {...}, "collections": {...}, "singles": {...} }
//   }
//
// JSON is written deterministically (sorted keys + 2-space indent) so
// file content is reproducible across machines. `migrationHash` is the
// canonical store for `migrate:check`'s offline integrity verification.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { FieldGroupNaming } from "../../field-groups/services/field-group-storage-names";
import { normalizeContributions } from "../pipeline/diff/contributions";
import type {
  ContributedElements,
  NextlySchemaSnapshot,
} from "../pipeline/diff/types";

import {
  isPermissionRecord,
  type PermissionRecord,
} from "./declared-permissions";
import {
  isEntitySettingsRecord,
  type EntitySettingsRecord,
} from "./entity-settings";
import { prepareWhole, type PreparedFile } from "./writer-hold";

/**
 * The envelope version of a snapshot whose field groups are on the current names
 * (`fieldGroupStorage: "current"`). Higher than a legacy snapshot's 1 on purpose: a CLI that
 * predates the record refuses any version it does not know ("upgrade your CLI"), so it stops
 * instead of reading the file as legacy and planning to drop every `fg_` table and create its
 * `comp_` twin. A legacy snapshot stays version 1 and is written byte-identically.
 */
export const CURRENT_NAMES_SNAPSHOT_VERSION = 2;

export interface SnapshotFile {
  /** 1 for a history on the legacy field-group names, 2 for one on the current names. */
  version: 1 | typeof CURRENT_NAMES_SNAPSHOT_VERSION;
  migrationHash: string;
  /**
   * The names this point of the history keeps field groups under: `"current"` once the project
   * moved to `dynamic_field_groups` / `fg_<slug>` / `_field_group_type`, and absent on the legacy
   * names. Absent on every file written before the record existed, which were all legacy, so an
   * existing history reads exactly as it did. Present exactly when `version` is 2.
   */
  fieldGroupStorage?: "current";
  snapshot: NextlySchemaSnapshot;
  /**
   * Elements the app contributed to tables another owner declares, by table.
   *
   * The snapshot holds such a table whole — the database has all of it, and
   * `migrate:resolve` compares the live table against this file — so which
   * parts of it are the APP's cannot be read back from the table itself. The
   * next diff needs exactly that; see `app-stream.ts`. Absent when the app
   * contributes to nobody's table, so a file that has none stays byte-identical
   * to one written before this field existed.
   */
  contributions?: Record<string, ContributedElements>;
  /**
   * Every collection's, Single's and field group's settings at this point:
   * labels, description, admin options, versioning, Draft/Published, the
   * localisation flag and each field's declaration (`entity-settings.ts`).
   *
   * Recorded whole in every snapshot, whatever its migration changed, so a
   * snapshot alone says what the settings were. Absent from a snapshot written
   * before settings were recorded, which says nothing about them: a reader
   * must never take the absence as settings cleared.
   */
  entities?: EntitySettingsRecord;
  /**
   * Every permission the app and each collection, Single and installed plugin
   * declares at this point, by owner (`declared-permissions.ts`), and no grant.
   *
   * Recorded whole in every snapshot, as the settings are. Absent from a
   * snapshot written before permissions were recorded, which says nothing about
   * them: a reader must never take the absence as permissions removed.
   */
  permissions?: PermissionRecord;
  /**
   * That every translated table in `snapshot` carries `localized: true` and its
   * `localizedColumns`, so a table without them was not translated. Written in
   * every snapshot, because a snapshot with no translated table looks the same
   * as one written before tables recorded it. Absent from such an older
   * snapshot, which may not say which tables were translated.
   */
  translatedFieldsRecorded?: true;
}

/**
 * The field-group names a snapshot's point of the history is on: `"current"` when it says so,
 * otherwise legacy, which is what every snapshot written before the record existed was on. The
 * one reading of the record, for every command that follows the history's naming.
 */
export function snapshotFieldGroupNaming(
  file: Pick<SnapshotFile, "fieldGroupStorage">
): FieldGroupNaming {
  return file.fieldGroupStorage === "current" ? "current" : "legacy";
}

/**
 * Whether a snapshot carries the registry metadata: every collection's,
 * Single's and field group's declaration (`entities`), which `nextly migrate`
 * writes the registry rows from. A snapshot written before declarations were
 * recorded has none and says nothing about the registry. The one reading of
 * that question, for the registry source and the first-run record alike.
 */
export function carriesRegistryMetadata(
  file: Pick<SnapshotFile, "entities">
): file is SnapshotFile & { entities: EntitySettingsRecord } {
  return file.entities !== undefined;
}

/**
 * Whether a parsed snapshot file is in the older shape a template's
 * hand-written migration ships (the blog template's): its entities listed as
 * `collections` and `singles`, with no `migrationHash`. It records no tables,
 * so a migration beside it runs verbatim, and no `entities`, so it is no
 * registry source; the rows it lists are added where absent
 * (`registerFromMigrations`). The one reading of that shape, for every reader
 * of a migration's snapshot.
 */
export function isOlderFormatSnapshot(parsed: unknown): boolean {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    !("migrationHash" in parsed) &&
    ("collections" in parsed || "singles" in parsed)
  );
}

/** Empty snapshot used for "first migration" (no prior state). */
export const EMPTY_SNAPSHOT: NextlySchemaSnapshot = { tables: [] };

/** One collection or Single a template's older-format snapshot lists. */
export interface TemplateEntity {
  slug: string;
  /** The table the template's migration made for it, where the file says. */
  tableName?: string;
  /** Whether the template made it with the Draft/Published columns. */
  status: boolean;
  /** Its top-level fields as listed: a name, a type and whatever else was written. */
  fields: { name: string; type: string; [key: string]: unknown }[];
}

/** The entities a template's older-format snapshot lists. */
export interface TemplateEntities {
  collections: TemplateEntity[];
  singles: TemplateEntity[];
}

/** Whether `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The entities under one key of an older-format snapshot. The key may be
 * absent; present, it is a list of entities, each with a slug and a list of
 * named, typed fields. Anything else is refused: read as an empty list, the
 * tables the template made would be taken as never made.
 */
function templateEntityList(
  file: Record<string, unknown>,
  key: "collections" | "singles",
  filename: string
): TemplateEntity[] {
  const value = file[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new SnapshotFileError(filename, `expected ${key} to be a list`);
  }
  return value.map((entry: unknown, index): TemplateEntity => {
    const at = `${key}[${index}]`;
    if (!isRecord(entry) || typeof entry.slug !== "string") {
      throw new SnapshotFileError(filename, `expected ${at} to have a slug`);
    }
    const fields = entry.fields ?? [];
    if (
      !Array.isArray(fields) ||
      !fields.every(
        (field: unknown): field is TemplateEntity["fields"][number] =>
          isRecord(field) &&
          typeof field.name === "string" &&
          typeof field.type === "string"
      )
    ) {
      throw new SnapshotFileError(
        filename,
        `expected ${at}.fields to be a list of fields, each with a name and a type`
      );
    }
    return {
      slug: entry.slug,
      ...(typeof entry.tableName === "string"
        ? { tableName: entry.tableName }
        : {}),
      status: entry.status === true,
      fields,
    };
  });
}

/**
 * What a template's older-format snapshot (`isOlderFormatSnapshot`) lists:
 * each collection and Single with its top-level fields. The one reading of
 * that file's content; a damaged list is refused as an invalid snapshot.
 */
function templateEntitiesOf(
  parsed: unknown,
  filename: string
): TemplateEntities {
  const file = isRecord(parsed) ? parsed : {};
  return {
    collections: templateEntityList(file, "collections", filename),
    singles: templateEntityList(file, "singles", filename),
  };
}

/** The newest snapshot, as `loadLatestSnapshot` reads it. */
export interface LatestSnapshot {
  filename: string;
  data: SnapshotFile;
  /**
   * Set where the file is a template's older-format one and `data` holds the
   * tables its entities were taken as made with (`TemplateStart`): it records
   * no settings and no permissions, and nothing in the database stands in for
   * that record either.
   */
  template?: true;
}

/**
 * The tables a template's listed entities are taken as already made with,
 * built by the caller from the declaration it holds (`template-start.ts`).
 */
export type TemplateStart = (
  template: TemplateEntities
) => NextlySchemaSnapshot;

/** A folder's file names, or none where there is no such folder. */
async function filesIn(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * The snapshot files in `metaDir` that record a written migration, oldest
 * first; none where the folder is absent. The one listing every reader of
 * snapshots starts from.
 *
 * A snapshot counts only once its migration file is beside the folder: the
 * snapshot is written first, so one whose writer stopped between the two
 * files describes a migration that was never written. Read as the newest it
 * would hide that change from the next `migrate:create`, and read by
 * `nextly migrate` it would stand for entities no migration made. Its `.sql`,
 * or a dialect's variant of it (`<name>.<dialect>.sql`), is what says the
 * migration exists.
 */
export async function recordedSnapshotNames(
  metaDir: string
): Promise<string[]> {
  const snapshots = (await filesIn(metaDir))
    .filter(f => f.endsWith(".snapshot.json"))
    .sort();
  if (snapshots.length === 0) return [];
  const migrations = (await filesIn(dirname(metaDir))).filter(f =>
    f.endsWith(".sql")
  );
  return snapshots.filter(snapshot => {
    const base = snapshot.slice(0, -".snapshot.json".length);
    return migrations.some(
      file => file === `${base}.sql` || file.startsWith(`${base}.`)
    );
  });
}

/**
 * The newest snapshot file's name in `metaDir`, by the same order
 * `loadLatestSnapshot` reads; undefined where the folder is absent or holds
 * none that records a written migration (`recordedSnapshotNames`).
 */
export async function newestSnapshotName(
  metaDir: string
): Promise<string | undefined> {
  return (await recordedSnapshotNames(metaDir)).at(-1);
}

/**
 * Read the latest snapshot file from `migrations/meta/`.
 *
 * "Latest" = alphabetically last, which corresponds to the highest
 * timestamp because filenames start with `YYYYMMDD_HHMMSS_mmm_`.
 *
 * Returns `null` if the directory doesn't exist or contains no
 * `.snapshot.json` files. Callers treat that as "first migration"
 * and use `EMPTY_SNAPSHOT`.
 *
 * A template's older-format snapshot records no tables. Given
 * `templateStart`, it is read as the tables that function builds from the
 * entities it lists, so the next migration holds only what changed since the
 * template. Without it, the file is refused as any file that is no snapshot.
 *
 * Throws `SnapshotFileError` on parse failure or invalid envelope so
 * the caller surfaces a clear error instead of a downstream
 * "cannot read property 'tables' of undefined" stack trace.
 */
export async function loadLatestSnapshot(
  metaDir: string,
  templateStart?: TemplateStart
): Promise<LatestSnapshot | null> {
  const latest = await newestSnapshotName(metaDir);
  if (latest === undefined) return null;
  const content = await readFile(resolve(metaDir, latest), "utf-8");
  if (templateStart !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Not JSON: `parseSnapshotFile` below says so.
    }
    if (isOlderFormatSnapshot(parsed)) {
      return {
        filename: latest,
        data: {
          version: 1,
          // The file's own content, hashed: it has no migration hash to carry.
          migrationHash: createHash("sha256").update(content).digest("hex"),
          snapshot: templateStart(templateEntitiesOf(parsed, latest)),
        },
        template: true,
      };
    }
  }
  return { filename: latest, data: parseSnapshotFile(content, latest) };
}

/**
 * F11 PR 3 review fix #4: thrown when a snapshot file is malformed,
 * unparseable, or has an unexpected version number. Includes the
 * filename so operators can find the offending file fast.
 */
export class SnapshotFileError extends Error {
  constructor(filename: string, reason: string) {
    super(`snapshot file ${filename} is invalid: ${reason}`);
    this.name = "SnapshotFileError";
  }
}

/**
 * Parse + validate a snapshot file. Catches:
 * - JSON parse failures (corrupt file, partial write from a crashed run).
 * - Wrong `version` (someone running an old nextly binary against a
 *   newer snapshot, or vice versa).
 * - Missing required fields (hand-edited files).
 *
 * The validation is structural, not full-schema — Zod-level validation
 * is deferred to a follow-up if the snapshot envelope grows complex.
 */
export function parseSnapshotFile(
  content: string,
  filename: string
): SnapshotFile {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new SnapshotFileError(
      filename,
      `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SnapshotFileError(filename, "expected a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1 && obj.version !== CURRENT_NAMES_SNAPSHOT_VERSION) {
    throw new SnapshotFileError(
      filename,
      `expected version: 1 or ${CURRENT_NAMES_SNAPSHOT_VERSION}, got ${JSON.stringify(obj.version)}. ` +
        "If this snapshot was created by a newer nextly version, upgrade your CLI."
    );
  }
  const namingProblem = fieldGroupStorageProblem(
    obj.version,
    obj.fieldGroupStorage
  );
  if (namingProblem !== undefined) {
    throw new SnapshotFileError(filename, namingProblem);
  }
  if (
    typeof obj.migrationHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(obj.migrationHash)
  ) {
    throw new SnapshotFileError(
      filename,
      `expected migrationHash to be a 64-char hex SHA-256, got ${JSON.stringify(obj.migrationHash)}`
    );
  }
  const snap = obj.snapshot;
  if (
    snap === null ||
    typeof snap !== "object" ||
    !Array.isArray((snap as { tables?: unknown }).tables)
  ) {
    throw new SnapshotFileError(
      filename,
      "expected snapshot.tables to be an array"
    );
  }
  const problem = optionalPartProblem(obj);
  if (problem !== undefined) throw new SnapshotFileError(filename, problem);
  return obj as unknown as SnapshotFile;
}

/**
 * What is wrong with a snapshot's field-group naming record. The record and the version go
 * together — version 2 exactly when the file says `"current"` — so a file whose two disagree was
 * edited by hand, and reading either one alone could plan against the wrong names.
 */
function fieldGroupStorageProblem(
  version: unknown,
  fieldGroupStorage: unknown
): string | undefined {
  if (fieldGroupStorage !== undefined && fieldGroupStorage !== "current") {
    return `expected fieldGroupStorage to be "current" when present, got ${JSON.stringify(fieldGroupStorage)}`;
  }
  if (version === CURRENT_NAMES_SNAPSHOT_VERSION && fieldGroupStorage === undefined) {
    return `expected fieldGroupStorage: "current" in a version ${CURRENT_NAMES_SNAPSHOT_VERSION} snapshot`;
  }
  if (version === 1 && fieldGroupStorage !== undefined) {
    return `expected version: ${CURRENT_NAMES_SNAPSHOT_VERSION} for a snapshot on the current field-group names, got version: 1`;
  }
  return undefined;
}

/** What is wrong with the envelope's optional parts, each checked only when present. */
function optionalPartProblem(obj: Record<string, unknown>): string | undefined {
  if (obj.contributions !== undefined && !isContributions(obj.contributions)) {
    return "expected contributions to map table names to their contributed element names";
  }
  if (obj.entities !== undefined && !isEntitySettingsRecord(obj.entities)) {
    return "expected entities to record each collection's, single's and field group's settings by slug";
  }
  if (obj.permissions !== undefined && !isPermissionRecord(obj.permissions)) {
    return "expected permissions to record each owner's declared permissions by slug";
  }
  if (
    obj.translatedFieldsRecorded !== undefined &&
    obj.translatedFieldsRecorded !== true
  ) {
    return `expected translatedFieldsRecorded to be true when present, got ${JSON.stringify(obj.translatedFieldsRecorded)}`;
  }
  return undefined;
}

/**
 * Where `writeSnapshot` writes the snapshot of the migration named `baseName`:
 * `<metaDir>/<baseName>.snapshot.json`, the pairing every reader of a
 * migrations folder relies on. A dry run names the file by it.
 */
export function snapshotPathOf(metaDir: string, baseName: string): string {
  return resolve(metaDir, `${baseName}.snapshot.json`);
}

/**
 * Write a snapshot file paired with a migration `.sql` file.
 *
 * The `migrationHash` is computed from the `.sql` file content so
 * `migrate:check` can verify integrity offline (no DB connection).
 */
export async function writeSnapshot(
  ...args: Parameters<typeof prepareSnapshot>
): Promise<string> {
  const file = await prepareSnapshot(...args);
  try {
    // Whole or not at all: a reader of the folder never finds half a snapshot.
    await file.place();
  } catch (error) {
    await file.discard();
    throw error;
  }
  return file.path;
}

/**
 * `writeSnapshot`, stopped before the file is put at its name: written in
 * full beside it, for a writer that places it with its migration file once
 * it has made its last check (`publishHeld`).
 */
export async function prepareSnapshot(
  metaDir: string,
  baseName: string,
  snapshot: NextlySchemaSnapshot,
  sqlContent: string,
  contributions: Readonly<Record<string, ContributedElements>> = {},
  /** Every entity's settings; omitted only by a caller that has none to record. */
  entities?: EntitySettingsRecord,
  /** Every declared permission, by owner; omitted only by a caller that knows none. */
  permissions?: PermissionRecord,
  /**
   * The field-group names this point of the history is on. Legacy writes the file exactly as
   * before the record existed (version 1, no record); current writes version 2 with
   * `fieldGroupStorage: "current"`.
   */
  fieldGroupNaming: FieldGroupNaming = "legacy"
): Promise<PreparedFile> {
  await mkdir(metaDir, { recursive: true });
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  const file: SnapshotFile = {
    ...(fieldGroupNaming === "current"
      ? {
          version: CURRENT_NAMES_SNAPSHOT_VERSION,
          fieldGroupStorage: "current" as const,
        }
      : { version: 1 as const }),
    migrationHash: computeMigrationHash(sqlContent),
    ...(Object.keys(contributions).length > 0
      ? {
          contributions: normalizeContributions(contributions),
        }
      : {}),
    // Key order is sorted by the replacer below, so the record is written the
    // same way whatever order the config declares its entities in.
    ...(entities !== undefined ? { entities } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    // The tables below carry the translated-field record as written here.
    translatedFieldsRecorded: true,
    // Sort tables by name for reproducibility across machines.
    snapshot: {
      tables: [...snapshot.tables]
        .map(t => ({
          name: t.name,
          columns: [...t.columns].sort((a, b) => a.name.localeCompare(b.name)),
          // Persist indexes only when tracked. A table built without index
          // data keeps `indexes` undefined (the pre-C1 sentinel), so the diff
          // skips the index dimension for it.
          ...(t.indexes !== undefined
            ? {
                indexes: [...t.indexes].sort(
                  (a, b) =>
                    a.name.localeCompare(b.name) ||
                    a.columns.join().localeCompare(b.columns.join())
                ),
              }
            : {}),
          // Foreign keys and checks, on the same terms as indexes: persisted
          // only when tracked, because `undefined` tells the diff to skip the
          // dimension. Leaving them out entirely made every later snapshot read
          // an extension table's constraints as untracked, so a change to one
          // after its first migration was never emitted.
          ...(t.foreignKeys !== undefined
            ? { foreignKeys: [...t.foreignKeys].sort(byName) }
            : {}),
          ...(t.checks !== undefined
            ? { checks: [...t.checks].sort(byName) }
            : {}),
          // persist the localization marker only when the entity IS localized, so a
          // non-localized table's JSON is byte-identical to a pre-marker snapshot (no churn).
          // The next migrate:create reads this to detect a `true → false` disable; an absent
          // marker reads as "unknown" and never triggers the destructive transition.
          // `localizedColumns` records what the companion actually holds, so a later disable
          // restores exactly those columns instead of re-guessing from a changed config.
          ...(t.localized === true
            ? {
                localized: true,
                ...(t.localizedColumns !== undefined
                  ? { localizedColumns: [...t.localizedColumns].sort() }
                  : {}),
                // Ordered by the column each entry names, whether it is the bare name an older
                // snapshot holds or the name-and-kind a current one does, so the file stays
                // stable across writes and the two spellings sort together.
                ...(t.uniqueLocalizedColumns !== undefined
                  ? {
                      uniqueLocalizedColumns: [
                        ...t.uniqueLocalizedColumns,
                      ].sort((a, b) =>
                        (typeof a === "string" ? a : a.column).localeCompare(
                          typeof b === "string" ? b : b.column
                        )
                      ),
                    }
                  : {}),
              }
            : {}),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
  const json = JSON.stringify(file, sortedKeysReplacer, 2);
  return prepareWhole(snapshotPathOf(metaDir, baseName), json + "\n");
}

/** Structural check of a snapshot file's `contributions`. */
function isContributions(
  value: unknown
): value is Record<string, ContributedElements> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const isNames = (names: unknown) =>
    Array.isArray(names) && names.every(name => typeof name === "string");
  return Object.values(value).every(
    elements =>
      elements !== null &&
      typeof elements === "object" &&
      isNames((elements as ContributedElements).columns) &&
      isNames((elements as ContributedElements).indexes) &&
      isNames((elements as ContributedElements).foreignKeys) &&
      isNames((elements as ContributedElements).checks)
  );
}

/**
 * SHA-256 of the SQL file content (hex-encoded). Used as
 * `nextly_migrations.sha256` in the DB and as `migrationHash` in
 * the paired snapshot file.
 */
export function computeMigrationHash(sqlContent: string): string {
  return createHash("sha256").update(sqlContent).digest("hex");
}

/**
 * Verify a SQL file's hash matches the paired snapshot's
 * `migrationHash`. Used by `migrate:check` (PR 4).
 */
export async function verifyMigrationHash(
  metaDir: string,
  sqlFilename: string,
  sqlContent: string
): Promise<{ ok: boolean; expected?: string; actual: string }> {
  const baseName = sqlFilename.replace(/\.sql$/, "");
  const snapshotPath = resolve(metaDir, `${baseName}.snapshot.json`);
  const actual = computeMigrationHash(sqlContent);
  let raw: string;
  try {
    raw = await readFile(snapshotPath, "utf-8");
  } catch {
    return { ok: false, expected: undefined, actual };
  }
  // F11 PR 3 review fix #4: validate the parsed envelope so a malformed
  // snapshot surfaces a clear error instead of "cannot read property
  // 'migrationHash' of undefined".
  const data = parseSnapshotFile(raw, `${baseName}.snapshot.json`);
  return {
    ok: data.migrationHash === actual,
    expected: data.migrationHash,
    actual,
  };
}

// JSON.stringify replacer that sorts object keys alphabetically. Arrays
// pass through as-is (their element order is meaningful — preserved by
// the caller via .sort() in writeSnapshot).
function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  ) {
    // After narrowing, Object.keys accepts `value` directly. A null prototype
    // keeps an own `__proto__` key (plugin options can hold one) a key.
    const sorted = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
