/**
 * Reading one stored field value as it is written, on a connection the caller
 * names.
 *
 * Every other read path in this domain is a READER's read: it runs the
 * collection's access rules and its read hooks, and it takes a pooled
 * connection. That is the right read for answering a request and the wrong one
 * for judging a write, for three reasons that do not overlap:
 *
 * - **The connection.** A write inside a transaction — a batch, an import —
 *   holds rows the pool cannot see until it commits. A judgement made on the
 *   pool reads the library as it was before the batch began, so two rows of
 *   one batch can each pass against a world without the other.
 * - **Hooks.** A read hook can hide or reshape a stored value for the reader in
 *   front of it. The value is still stored, and still what a page is built from.
 * - **Access.** A row the writer may not read can still be placed on a page they
 *   can save; the judgement is about what renders, not about who may look.
 *
 * So this reads the stored row by id on the connection it is handed, with
 * neither, and the working-draft overlay decided by the same rule the preview
 * read uses (`resolveDraftOverlay`), so "the draft" means one thing everywhere.
 *
 * It returns only the fields it is asked for, read from one row and one
 * working draft however many there are. What a caller may name is decided by
 * the caller of this module, as a {@link FieldScope}; nothing here widens it.
 *
 * It is also where a conditional write is judged. A writer that read a stored
 * value and computed a replacement from it registers what it read against the
 * context object it hands its write ({@link expectStoredValue}), and the write
 * path reads the value again HERE, on its own transaction, once it holds the
 * entry's row lock ({@link holdStoredExpectation}). The read the writer made and the read
 * the write path makes are the same read, and both are hashed by
 * {@link storedValueHash}, so the two can only disagree when the stored value
 * did.
 *
 * @module domains/collections/services/stored-field-read
 */
import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type {
  DynamicCollectionRecord,
  FieldDefinition,
} from "@nextly/schemas/dynamic-collections";

import type { FieldConfig } from "../../../collections/fields/types";
import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { keysNoUpdateStores } from "../../../lib/immutable-system-fields";
import {
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_VERSION_KEY,
} from "../../../lib/system-columns";
import type {
  PluginStoredValue,
  PluginStoredValueTarget,
} from "../../../plugins/contributions";
import { addressableFields } from "../../../shared/addressable-fields";
import type { EntryWriteContext } from "../../../shared/lib/entry-validation";
import type { LocalizedFieldRef } from "../../i18n/companion-join";
import {
  publishesPerLanguage,
  storesPerLanguage,
} from "../../i18n/per-language-storage";
import {
  buildCompanionSchema,
  type CompanionSchema,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  resolveCompanionSchemaReadiness,
} from "../../i18n/runtime/companion-readiness";
import { classifyFieldKind } from "../../schema/services/field-column-descriptor";
import type { VersionsDbApi } from "../../versions/db-api";
import {
  draftDocumentFacts,
  resolveDraftOverlay,
  type DraftDocumentConfig,
} from "../../versions/draft-overlay";
import { resolveComponentSchemas } from "../../versions/restore-version";
import { VersionsRepository } from "../../versions/versions-repository";

import { collectionFields, collectionTableName } from "./collection-utils";

/** What one stored-field read is pointed at. */
export type StoredFieldTarget = PluginStoredValueTarget;

/** The connection a stored-field read runs on. */
export interface StoredFieldConnection {
  /** Every row query runs here: the pool, or a write's transaction. */
  readonly db: VersionsDbApi;
  /**
   * The same connection as a Drizzle executor, for the registry lookup, or
   * `undefined` for the pool. Without it the lookup would take a second
   * connection from inside the transaction.
   */
  readonly executor: unknown;
  /** The app's default language, which keys an unlocalized document's working draft. */
  readonly defaultLocale: string | null;
}

/**
 * The context a write path hands validation: which entry, and stored reads on
 * the connection that write runs on.
 *
 * One builder for every write path, so the connection a validator reads on is
 * always the one its write uses — the pool before a transaction opens, the
 * transaction inside one — and never a second choice made per call site.
 */
export function entryWriteContext(args: {
  kind: EntryWriteContext["kind"];
  slug: string;
  id?: string;
  /** The language the write is judged in, for a document kept per language. */
  locale?: string;
  connection: StoredFieldConnection;
}): EntryWriteContext {
  const records = registryRecords(args.connection);
  return {
    kind: args.kind,
    slug: args.slug,
    ...(args.id === undefined ? {} : { id: args.id }),
    ...(args.locale === undefined ? {} : { locale: args.locale }),
    defaultLocale: args.connection.defaultLocale,
    // The executor is the transaction's own, and it is handed only for one.
    inTransaction: args.connection.executor !== undefined,
    readStored: (allowedType, target) =>
      readStoredField(args.connection, allowedType, target, records),
  };
}

/** What {@link storedReadsOn} answers. */
export interface StoredReads {
  /** One stored value of `allowedType`, as {@link readStoredField} reads it. */
  read(
    allowedType: string,
    target: StoredFieldTarget
  ): Promise<PluginStoredValue>;
  /** The document's fields of `allowedType`, as a stored read names them. */
  fieldPaths(
    document: { readonly collection: string } | { readonly single: string },
    allowedType: string
  ): Promise<string[]>;
}

/**
 * Stored reads on one connection for one handler: values of a field type, and
 * which of a document's fields are of it, sharing one registry lookup per
 * collection as a write context does ({@link entryWriteContext}).
 */
export function storedReadsOn(connection: StoredFieldConnection): StoredReads {
  const records = registryRecords(connection);
  return {
    read: (allowedType, target) =>
      readStoredField(connection, allowedType, target, records),
    fieldPaths: async (document, allowedType) => {
      const fields =
        "single" in document
          ? ((
              await getService("singleRegistryService").getSingleBySlug(
                document.single,
                connection.executor
              )
            )?.fields as unknown as FieldDefinition[] | undefined)
          : await records(document.collection).then(record =>
              record === null ? undefined : collectionFields(record)
            );
      return fields === undefined ? [] : pathsOfType(fields, allowedType);
    },
  };
}

/**
 * The paths of the fields of `allowedType` among `fields`, at their level and
 * through named groups, as a stored read names them (`hero.body`). Unnamed
 * groups store their fields at the level they sit in; a repeater's rows and a
 * field-group instance are not walked, being stored elsewhere. A group kept
 * per language is walked: the write holds a value for a field inside it,
 * though a stored read of that field is refused.
 */
function pathsOfType(
  fields: readonly FieldDefinition[],
  allowedType: string,
  prefix = ""
): string[] {
  const paths: string[] = [];
  for (const field of storedAtLevel(fields)) {
    if (typeof field.name !== "string" || field.name === "") continue;
    const path = `${prefix}${field.name}`;
    if (field.type === allowedType) {
      paths.push(path);
    } else if (field.type === "group" && Array.isArray(field.fields)) {
      paths.push(...pathsOfType(field.fields, allowedType, `${path}.`));
    }
  }
  return paths;
}

/** A collection's registry record by slug, or `null` where there is none. */
type RegistryRecords = (
  slug: string
) => Promise<DynamicCollectionRecord | null>;

/**
 * Registry records read on `connection`, each collection's at most once.
 *
 * One per write context, so per write: a composition reads up to a hundred
 * definitions from one collection, and the record is the same for every one of
 * them within a write. Not kept beyond it, so a schema change is seen by the
 * next write. A failed lookup is forgotten rather than kept, so a transient
 * error is not repeated for the rest of the write.
 */
function registryRecords(connection: StoredFieldConnection): RegistryRecords {
  const held = new Map<string, Promise<DynamicCollectionRecord | null>>();
  return slug => {
    let record = held.get(slug);
    if (record === undefined) {
      record = getService("collectionRegistryService").getCollectionBySlug(
        slug,
        connection.executor
      );
      held.set(slug, record);
      record.catch(() => held.delete(slug));
    }
    return record;
  };
}

/**
 * Which fields a stored read may answer. A field outside it is refused by
 * name rather than answered, because answering would make the scope the
 * caller set a suggestion.
 */
export interface FieldScope {
  /** What a refusal says the scope is, as one sentence; empty to say nothing. */
  readonly only: string;
  /** Whether a field declared as `field` is one this read may answer. */
  admits(field: FieldDefinition): boolean;
  /**
   * Why a field the scope admits by type must still not be answered, asked of
   * the field's top-level name; `undefined` where nothing stops it.
   */
  refusal?(entity: StoredEntityFacts, topLevel: string): string | undefined;
}

/** What a {@link FieldScope} is told about the entity a field belongs to. */
export interface StoredEntityFacts {
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly fields: readonly FieldDefinition[];
}

/** The scope of a field type's validator: the values of its own type alone. */
function scopeOfType(allowedType: string): FieldScope {
  return {
    only: `Only top-level "${allowedType}" fields, or ones inside named groups, can be read.`,
    admits: field => field.type === allowedType,
  };
}

/**
 * Every field the path rule reaches, whatever its type: for judging a write
 * against what its writer read, which answers no value to anyone.
 */
const EVERY_FIELD: FieldScope = { only: "", admits: () => true };

/** What one stored read of several fields of one document is pointed at. */
export type StoredFieldsTarget = DistributiveOmit<
  PluginStoredValueTarget,
  "field"
> & {
  /** Each field's name at top level, or its path through named groups. */
  readonly fields: readonly string[];
};

/** `Omit` taken of each member of a union, so the union survives it. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** What one stored read of several fields found. */
export interface StoredFieldsRead {
  /** Whether the entry, or the single's row, is stored at all. */
  readonly found: boolean;
  /** Each field asked for, by the name or path it was asked by. */
  readonly values: ReadonlyMap<string, PluginStoredValue>;
  /**
   * Whether a working draft is pending where a preview would show it. Asked
   * only of a `draft` read, or of one made with `askDraft`; `false` otherwise.
   */
  readonly workingDraft: boolean;
  /**
   * The live row's lifecycle state in the language read, asked only with
   * `askState`: the main row's `status`, or the language row's own `_status`
   * for a language other than the default where translations keep one.
   * `undefined` where not asked or the entity has no lifecycle; `null` where
   * it has one and the row stores no state.
   */
  readonly liveState?: string | null;
}

/**
 * Read one stored field of one entry or single, as `form` holds it: a
 * top-level field, or one inside named groups, named by its path
 * (`hero.body`).
 *
 * `allowedType` is the only field type this read will return: a field of any
 * other type, or a field the entity does not declare at top level or inside
 * named groups, is refused by name rather than answered.
 *
 * The one-field case of {@link readStoredFieldsOn}, which says how each form
 * and language is read.
 */
export async function readStoredField(
  connection: StoredFieldConnection,
  allowedType: string,
  target: StoredFieldTarget,
  records: RegistryRecords = registryRecords(connection)
): Promise<PluginStoredValue> {
  const { field, ...document } = target;
  const read = await readStoredFieldsOn(
    connection,
    scopeOfType(allowedType),
    { ...document, fields: [field] },
    { records }
  );
  return read.values.get(field) ?? { kind: "absent" };
}

/**
 * Read stored fields of one entry or single, as `form` holds them, each a
 * top-level field or one inside named groups named by its path (`hero.body`).
 * Every field must be one `scope` admits.
 *
 * A named group stores its value whole, in one column of the group's name, so
 * a field inside one is read from that column and then walked to by name. The
 * working draft carries the same nesting and is walked the same way.
 *
 * A field stored per language is read in `target.locale`, or the app's
 * default language when none is named: from the language's own companion row,
 * never from the main row, which holds nothing a reader of that language
 * receives. A language that stores nothing for it is absent rather than
 * another language's value, so a caller judging a write against it measures
 * against the field's starting value, which refuses more and never less.
 *
 * The row is read once and the working draft once, whatever the number of
 * fields. `askDraft` asks whether a working draft is pending on a `published`
 * read too, without reading values from it.
 */
export async function readStoredFieldsOn(
  connection: StoredFieldConnection,
  scope: FieldScope,
  target: StoredFieldsTarget,
  options: {
    records?: RegistryRecords;
    askDraft?: boolean;
    askState?: boolean;
  } = {}
): Promise<StoredFieldsRead> {
  const records = options.records ?? registryRecords(connection);
  const fields = [...new Set(target.fields)];
  const entity = await storedEntity(connection, records, target, scope);
  const placed = placedFields(entity, target, scope, fields);
  const locale = target.locale ?? connection.defaultLocale ?? null;
  const state =
    options.askState === true
      ? stateSource(entity, locale, connection.defaultLocale)
      : undefined;
  const row = await storedRow(
    connection,
    entity,
    target,
    rowColumns(placed, state)
  );
  if (row === undefined) return notStored(fields);
  const id = String(row.id);
  const draft =
    showsUnpublished(target.form) || options.askDraft === true
      ? await pendingWorkingDraft(connection, entity, id, locale)
      : undefined;
  // The working draft a `draft` read shows, and the one language row every
  // field kept per language that it does not carry is read from, in one query
  // however many such fields are asked for.
  const shownDraft = showsUnpublished(target.form) ? draft : undefined;
  const language = await languageRow(
    connection,
    {
      fields: fromLanguageRow(placed, shownDraft),
      state: state === "language" ? companionOf(entity) : null,
    },
    { id, locale, target }
  );
  return {
    found: true,
    values: shownValues(placed, row, language.values, shownDraft),
    workingDraft: draft !== undefined,
    ...liveStateOf(state, row, language),
  };
}

/**
 * Settle on `connection`, a pooled one, what a read inside a transaction can
 * only remember: whether the entity's language store is ready. Inside a
 * transaction the read consults the remembered verdict and never resolves
 * it, since resolving queries and on PostgreSQL a query against a missing
 * relation aborts the transaction; so a read about to run in one asks here
 * first. Refuses what the read itself would refuse about the entity.
 */
export async function prepareStoredRead(
  connection: StoredFieldConnection,
  scope: FieldScope,
  target: StoredFieldsTarget
): Promise<void> {
  const entity = await storedEntity(
    connection,
    registryRecords(connection),
    target,
    scope
  );
  const companion = companionOf(entity);
  if (companion !== null) {
    await resolveCompanionSchemaReadiness(getService("adapter"), companion);
  }
}

/** One field a read is asked for, with where it is stored. */
interface PlacedField {
  readonly field: string;
  readonly path: StoredFieldPath;
  /** The field's language-row column, for a field kept per language. */
  readonly perLanguage: CompanionField | undefined;
}

/**
 * Each field with where it is stored. Only a top-level field can be kept per
 * language on its own: a field inside a group is stored in the group's value,
 * and a group kept per language is refused by the path rule.
 */
function placedFields(
  entity: StoredEntity,
  target: StoredFieldsTarget,
  scope: FieldScope,
  fields: readonly string[]
): PlacedField[] {
  return fields.map(field => {
    const path = storedFieldPath(entity, { ...target, field }, scope);
    return {
      field,
      path,
      perLanguage:
        path.within.length === 0
          ? companionFieldOf(entity, path.column)
          : undefined,
    };
  });
}

/** The main row's columns a read needs: its fields' own, and its state's. */
function rowColumns(
  placed: readonly PlacedField[],
  state: "row" | "language" | undefined
): string[] {
  return [
    ...placed
      .filter(({ perLanguage }) => perLanguage === undefined)
      .map(({ path }) => path.column),
    ...(state === "row" ? ["status"] : []),
  ];
}

/** A read of a document that is not stored: every field absent. */
function notStored(fields: readonly string[]): StoredFieldsRead {
  return {
    found: false,
    values: new Map(fields.map(field => [field, { kind: "absent" }])),
    workingDraft: false,
  };
}

/** The fields kept per language whose value the shown draft does not carry. */
function fromLanguageRow(
  placed: readonly PlacedField[],
  draft: PendingDraft | undefined
): LanguageRowAsk["fields"] {
  return placed.flatMap(({ field, path, perLanguage }) =>
    perLanguage === undefined || draftCarries(draft, path.column)
      ? []
      : [{ field, kept: perLanguage }]
  );
}

/** Each field's value as the read shows it, by the name it was asked by. */
function shownValues(
  placed: readonly PlacedField[],
  row: Record<string, unknown>,
  translated: ReadonlyMap<string, unknown>,
  draft: PendingDraft | undefined
): Map<string, PluginStoredValue> {
  const values = new Map<string, PluginStoredValue>();
  for (const { field, path, perLanguage } of placed) {
    const shown = shownValue({
      column: path.column,
      stored: row[path.column],
      perLanguage,
      translated,
      draft,
    });
    const reached =
      shown === undefined ? undefined : valueWithin(shown.value, path.within);
    values.set(field, storedValueOf(reached, path));
  }
  return values;
}

/**
 * A reached value as a stored value. Only a column's own value is stored
 * encoded: a value reached inside a group was decoded with the group, and
 * decoding it again would turn a string holding JSON text ("123", "null")
 * into what that text says.
 */
function storedValueOf(
  reached: { value: unknown } | undefined,
  path: StoredFieldPath
): PluginStoredValue {
  if (reached === undefined) return { kind: "absent" };
  return {
    kind: "value",
    value:
      path.within.length === 0
        ? decoded(reached.value, path.json)
        : reached.value,
  };
}

/** The live state a read reports, where it was asked for one. */
function liveStateOf(
  state: "row" | "language" | undefined,
  row: Record<string, unknown>,
  language: LanguageRow
): { liveState?: string | null } {
  if (state === undefined) return {};
  return { liveState: state === "row" ? stateOf(row.status) : language.state };
}

/**
 * Where the live state of a read's language is stored: the main row, or the
 * language row for a language other than the default where translations keep
 * a state of their own, as every write path stamps it. `undefined` for an
 * entity with no lifecycle.
 */
function stateSource(
  entity: StoredEntity,
  locale: string | null,
  defaultLocale: string | null
): "row" | "language" | undefined {
  if (!entity.status) return undefined;
  const ownLanguage =
    entity.localized && locale !== null && locale !== defaultLocale;
  return ownLanguage && companionOf(entity)?.hasStatus === true
    ? "language"
    : "row";
}

/** A stored state as a string, or `null` where nothing names one. */
function stateOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Where a stored read's field is kept: the column its top-level field is
 * stored in, the names that lead from that column's value to the field, and
 * the type the field is declared with.
 */
interface StoredFieldPath {
  readonly column: string;
  /** Empty for a top-level field; the group names after the first, then the field's own. */
  readonly within: readonly string[];
  /** Whether the field is stored as JSON, which a column may hold as text. */
  readonly json: boolean;
}

/**
 * The column `target.field` is read from, refusing a path that does not lead
 * through named groups alone to a field `scope` admits.
 *
 * Only a named group is walked. A repeater's rows, a field-group instance and
 * a presentational group are not: a row is named by its index, which a write
 * can move, an instance is stored in its own table, and a presentational group
 * stores nothing of its own. A group kept per language is refused as well,
 * since its value is not the main row's to answer for every language; so is a
 * group below the top flagged as translated in an entity kept per language:
 * its author asked for a value per language, and the shared value is not one.
 */
function storedFieldPath(
  entity: StoredEntity,
  target: StoredFieldTarget,
  scope: FieldScope
): StoredFieldPath {
  const refuse = (why: string) => refused(target, scope.only, why);
  const names = target.field.split(".");
  const column = names[0] ?? target.field;
  const fields = innermostGroupFields(entity, names.slice(0, -1), refuse);
  const field = fields.find(entry => entry.name === names.at(-1));
  if (field === undefined || !scope.admits(field)) {
    throw refuse("is not a field of that type");
  }
  const why = scope.refusal?.(entity, column);
  if (why !== undefined) throw refuse(why);
  return { column, within: names.slice(1), json: storesJson(field) };
}

/** A named group: a `group` field that declares fields of its own. */
type NamedGroup = FieldDefinition & { fields: FieldDefinition[] };

/**
 * The fields of the innermost group `groups` names, walking from the entity's
 * top level; the entity's own fields for a top-level read. Each level is read
 * with its unnamed groups flattened, as they store their fields at the level
 * they sit in. Refused with `refuse`'s error where a name is not a named
 * group, or names one kept per language.
 */
function innermostGroupFields(
  entity: StoredEntity,
  groups: readonly string[],
  refuse: (why: string) => NextlyError
): readonly FieldDefinition[] {
  let fields = storedAtLevel(entity.fields);
  for (const [depth, name] of groups.entries()) {
    const group = namedGroupIn(fields, name);
    if (group === undefined) throw refuse("is not inside named groups alone");
    if (groupKeptPerLanguage(entity, group, depth)) {
      throw refuse("is inside a group kept per language");
    }
    fields = storedAtLevel(group.fields);
  }
  return fields;
}

/**
 * The fields whose values a level stores, as core's addressable-field walk
 * answers it: a presentational (unnamed) group's fields are its parent's.
 */
function storedAtLevel(
  fields: readonly FieldDefinition[]
): readonly FieldDefinition[] {
  return addressableFields(fields) as unknown as FieldDefinition[];
}

/** The named group `name` among `fields`, or `undefined` where it is none. */
function namedGroupIn(
  fields: readonly FieldDefinition[],
  name: string
): NamedGroup | undefined {
  return fields.find(
    (entry): entry is NamedGroup =>
      entry.name === name &&
      entry.type === "group" &&
      Array.isArray(entry.fields)
  );
}

/**
 * Whether a group on a read's path keeps its value per language: a top-level
 * one by the companion schema every localized write is split by, and one
 * below it by its own flag, in an entity kept per language.
 */
function groupKeptPerLanguage(
  entity: StoredEntity,
  group: NamedGroup,
  depth: number
): boolean {
  return depth === 0
    ? companionFieldOf(entity, group.name) !== undefined
    : entity.storedPerLanguage && group.localized === true;
}

/**
 * The value `names` lead to inside a group's stored value, or `undefined`
 * where a group on the way holds no such key: the field then stores nothing.
 *
 * A group's value is JSON, stored as text on SQLite and as raw storage in a
 * version snapshot, so a group read as a string is parsed the way every read
 * path parses it. One that does not parse to an object holds nothing.
 */
function valueWithin(
  value: unknown,
  names: readonly string[]
): { value: unknown } | undefined {
  let at = value;
  for (const name of names) {
    const holder = typeof at === "string" ? parsedJson(at) : at;
    if (
      typeof holder !== "object" ||
      holder === null ||
      Array.isArray(holder) ||
      !Object.hasOwn(holder, name)
    ) {
      return undefined;
    }
    at = (holder as Record<string, unknown>)[name];
  }
  return { value: at };
}

/**
 * The value a read shows: the pending working draft's, where `at.draft` is
 * the one a `draft` read shows and it carries the column; otherwise the
 * stored value, read from the language's own companion row for a field kept
 * per language and from the main row for any other.
 *
 * A draft that does not carry the column leaves the stored value standing,
 * which is what promoting it would do. A language row that holds nothing for
 * a field kept per language leaves it with no value.
 */
function shownValue(at: {
  /** The column read: the field's own, or the top-level group holding it. */
  readonly column: string;
  readonly stored: unknown;
  readonly perLanguage: CompanionField | undefined;
  /** The language row's values, by field name, as {@link languageValues} read them. */
  readonly translated: ReadonlyMap<string, unknown>;
  readonly draft: PendingDraft | undefined;
}): { value: unknown } | undefined {
  const snapshot = at.draft?.snapshot;
  if (draftCarries(at.draft, at.column) && isRecord(snapshot)) {
    return { value: snapshot[at.column] };
  }
  if (at.perLanguage === undefined) return { value: at.stored };
  return at.translated.has(at.perLanguage.field.name)
    ? { value: at.translated.get(at.perLanguage.field.name) }
    : undefined;
}

/** Whether `draft`'s snapshot holds a value for `column`. */
function draftCarries(
  draft: PendingDraft | undefined,
  column: string
): boolean {
  const snapshot = draft?.snapshot;
  return isRecord(snapshot) && Object.hasOwn(snapshot, column);
}

/** Whether `value` is an object whose keys can be read as a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** What a read needs to know about the entity it reads from. */
interface StoredEntity {
  readonly kind: "collection" | "single";
  readonly slug: string;
  /** The registry record, which carries the draft lifecycle's switches. */
  readonly record: unknown;
  readonly fields: readonly FieldDefinition[];
  readonly tableName: string;
  /** Whether the entity keeps translatable values per language. */
  readonly localized: boolean;
  /** Whether it has a draft/published status, kept per language as well. */
  readonly status: boolean;
  /**
   * Whether its translatable values are kept per language: when it is translated, or for every
   * entity under `experimental.perLanguageStorage`. Where a value is read from; `localized` stays
   * whether its drafts are kept per language.
   */
  readonly storedPerLanguage: boolean;
}

/**
 * The entity's REGISTRY record, read on the same connection: the collection's,
 * or the single's.
 *
 * The registry rather than a metadata service, which adds the entry form's
 * synthetic fields: a column the table does not have is not a value anyone
 * stored.
 */
async function storedEntity(
  connection: StoredFieldConnection,
  records: RegistryRecords,
  target: StoredFieldsTarget,
  scope: FieldScope
): Promise<StoredEntity> {
  // A refusal names the field where one was asked for, as it always has.
  const named: RefusedTarget =
    target.fields.length === 1
      ? { ...target, field: target.fields[0] }
      : target;
  if ("single" in target) {
    const single = await getService("singleRegistryService").getSingleBySlug(
      target.single,
      connection.executor
    );
    if (single === null) throw refused(named, scope.only, "names no single");
    return {
      kind: "single",
      slug: target.single,
      record: single,
      fields: (single.fields ?? []) as unknown as FieldDefinition[],
      tableName: single.tableName,
      localized: single.localized === true,
      status: (single as { status?: unknown }).status === true,
      storedPerLanguage: storesPerLanguage(single),
    };
  }
  const collection = await records(target.collection);
  if (collection === null) {
    throw refused(named, scope.only, "names no collection");
  }
  return {
    kind: "collection",
    slug: target.collection,
    record: collection,
    fields: collectionFields(collection),
    tableName: collectionTableName(collection, target.collection),
    localized: (collection as { localized?: unknown }).localized === true,
    status: (collection as { status?: unknown }).status === true,
    storedPerLanguage: storesPerLanguage(collection),
  };
}

/** The select surface a companion read needs, on a Drizzle executor. */
interface CompanionSelect {
  select(projection: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): Promise<Record<string, unknown>[]>;
      };
    };
  };
}

/** A field kept per language, with the companion table that holds it. */
interface CompanionField {
  readonly companion: CompanionSchema;
  readonly field: LocalizedFieldRef;
}

/**
 * The companion row's column for `name`, when the entity keeps it per
 * language; `undefined` when it is stored on the main row.
 *
 * Read from the companion schema every localized write is split by, so a field
 * is read where it was written: a flag on a field of an unlocalized entity
 * keeps it on the main row, and a localized entity's text fields are kept per
 * language unflagged.
 */
function companionFieldOf(
  entity: StoredEntity,
  name: string
): CompanionField | undefined {
  const companion = companionOf(entity);
  const field = companion?.localizedFields.find(entry => entry.name === name);
  return companion === null || field === undefined
    ? undefined
    : { companion, field };
}

/**
 * The entity's companion schema, built as every localized write splits by;
 * `null` for an entity that keeps nothing per language.
 */
function companionOf(entity: StoredEntity): CompanionSchema | null {
  // Where its translatable values are kept: per language when it is translated, or for every
  // entity under `experimental.perLanguageStorage`.
  if (!entity.storedPerLanguage) return null;
  return buildCompanionSchema({
    slug: entity.slug,
    tableName: entity.tableName,
    fields: entity.fields as unknown as { name: string; type: string }[],
    dialect: getService("adapter").dialect,
    // A `_status` of each language only where each language publishes on its own.
    status: publishesPerLanguage(entity),
  });
}

/**
 * The entity's stored row: the entry by id, or the single's one row. Its id,
 * which keys the companion rows and the working draft, and each of `columns`,
 * the ones the main row holds of what is read.
 */
async function storedRow(
  connection: StoredFieldConnection,
  entity: StoredEntity,
  target: StoredFieldsTarget,
  columns: readonly string[]
): Promise<Record<string, unknown> | undefined> {
  const rows = await connection.db.select<Record<string, unknown>>(
    entity.tableName,
    {
      // Only what is asked for: a row can hold other large values, and a
      // composition reads up to a hundred definitions in one save.
      columns: ["id", ...new Set(columns)],
      ...("single" in target
        ? {}
        : { where: { and: [{ column: "id", op: "=", value: target.id }] } }),
      limit: 1,
    }
  );
  return rows[0];
}

/** What one read of a language row is asked for. */
interface LanguageRowAsk {
  /** The fields kept per language to read from it. */
  readonly fields: readonly {
    readonly field: string;
    readonly kept: CompanionField;
  }[];
  /** The companion whose `_status` is the language's state, where it is asked. */
  readonly state: CompanionSchema | null;
}

/** What one read of a language row found. */
interface LanguageRow {
  /** The fields that language stores a value for, by field name. */
  readonly values: ReadonlyMap<string, unknown>;
  /** The language's own state, where asked; `null` where none is stored. */
  readonly state: string | null;
}

const NO_LANGUAGE_ROW: LanguageRow = { values: new Map(), state: null };

/**
 * One language's row of the companion table, read once: the values of the
 * fields kept per language asked for, with no fallback to another language,
 * and the language's own state where it is asked. None is read where neither
 * is asked for.
 *
 * Every field read here belongs to one entity, so to one companion table and
 * one row of it for this entry and language.
 */
async function languageRow(
  connection: StoredFieldConnection,
  ask: LanguageRowAsk,
  at: {
    readonly id: string;
    readonly locale: string | null;
    readonly target: StoredFieldsTarget;
  }
): Promise<LanguageRow> {
  const companion = ask.fields[0]?.kept.companion ?? ask.state;
  if (companion === null || companion === undefined) return NO_LANGUAGE_ROW;
  const locale = await readableLanguage(connection, companion, ask, at);
  // Only the columns asked for, of the one row for this entry and language: a
  // translation row can hold every other large value of the page, and a save
  // reads this for each stored form. Read as stored, whatever the language's
  // status, as the main row is for a field kept there. Each column is selected
  // under its position, so no field name can collide with another's key.
  const table = companion.table as Record<string, unknown>;
  const projection = {
    ...Object.fromEntries(
      ask.fields.map(({ kept }, index) => [
        `c${index}`,
        table[kept.field.column],
      ])
    ),
    ...(ask.state === null ? {} : { s: table._status }),
  };
  const rows = await (
    (connection.executor ??
      getService("adapter").getDrizzle()) as CompanionSelect
  )
    .select(projection)
    .from(companion.table)
    .where(
      and(eq(table._parent as never, at.id), eq(table._locale as never, locale))
    )
    .limit(1);
  return { values: languageValuesOf(ask, rows[0]), state: stateOf(rows[0]?.s) };
}

/**
 * The language a row is read in, once its store can answer.
 *
 * Inside a write's transaction the remembered readiness verdict is read and
 * never resolved: resolving queries, and on PostgreSQL a query against a
 * missing relation aborts the transaction. A companion not known to be ready
 * is refused rather than answered as empty, which a caller could not tell from
 * a language that stores nothing.
 */
async function readableLanguage(
  connection: StoredFieldConnection,
  companion: CompanionSchema,
  ask: LanguageRowAsk,
  at: { readonly locale: string | null; readonly target: StoredFieldsTarget }
): Promise<string> {
  const field = ask.fields[0]?.field ?? "status";
  if (at.locale === null) {
    throw refused(
      { ...at.target, field },
      "",
      "is kept per language, and no language is set"
    );
  }
  const adapter = getService("adapter");
  const readiness =
    connection.executor === undefined
      ? await resolveCompanionSchemaReadiness(adapter, companion)
      : cachedCompanionReadiness(adapter, companion.companionTableName);
  if (readiness !== "ready") {
    const document =
      "single" in at.target ? at.target.single : at.target.collection;
    throw NextlyError.serviceUnavailable({
      // Not a refusal of the caller's request: the language store is still
      // being set up, so a reader can tell "cannot read yet" from an error.
      publicMessage: "This language's content can't be read yet.",
      logMessage: `"${document}.${field}" is kept per language, and that store is not ready.`,
    });
  }
  return at.locale;
}

/**
 * The values a language row holds for the fields asked, by field name. No row,
 * or a row holding nothing for a field: either way the language stores
 * nothing for it.
 */
function languageValuesOf(
  ask: LanguageRowAsk,
  row: Record<string, unknown> | undefined
): ReadonlyMap<string, unknown> {
  const values = new Map<string, unknown>();
  ask.fields.forEach(({ kept }, index) => {
    const value = row?.[`c${index}`];
    if (value !== null && value !== undefined) {
      values.set(kept.field.name, value);
    }
  });
  return values;
}

/** A pending working draft a preview would show, as its version row holds it. */
interface PendingDraft {
  readonly snapshot: unknown;
}

/**
 * The pending working draft, where a preview would show it.
 *
 * `undefined` where the preview would show the stored row: the document has
 * no draft lifecycle, none is pending, or the shared rule declines to overlay
 * it. A document kept per language keeps a draft per language, so the one
 * looked for is `locale`'s.
 */
async function pendingWorkingDraft(
  connection: StoredFieldConnection,
  entity: StoredEntity,
  id: string,
  locale: string | null
): Promise<PendingDraft | undefined> {
  const facts = draftDocumentFacts({
    ...(entity.record as DraftDocumentConfig),
    localized: entity.localized,
  });
  const fields = entity.fields as unknown as FieldConfig[];
  const overlay = (
    componentSchemas: Parameters<
      typeof resolveDraftOverlay
    >[0]["componentSchemas"]
  ) =>
    resolveDraftOverlay({
      ...facts,
      entityKind: entity.kind,
      fields,
      componentSchemas,
      includeWorkingDraft: true,
      // As the system: this judges what a preview renders, not who may see it.
      callerMayEdit: true,
      requestLocale: locale,
      defaultLocale: connection.defaultLocale,
    });

  // The cheap half first, as the preview read does: with no schemas the rule can
  // only be more permissive, so a refusal here is final.
  const provisional = overlay(null);
  if (!provisional.overlay) return undefined;

  const draft = await new VersionsRepository(connection.db).findWorkingDraft(
    { scopeKind: entity.kind, scopeSlug: entity.slug, entryId: id },
    provisional.draftLocale
  );
  if (draft === undefined) return undefined;

  // The confirming half, against resolved schemas: a draft nothing could promote
  // is not one the preview shows.
  // On the write's own connection: inside a transaction a pooled read could
  // wait behind the very connection the transaction holds.
  const schemas = await resolveComponentSchemas(fields, connection.executor);
  if (!overlay(schemas).overlay) return undefined;
  return { snapshot: draft.snapshot };
}

/**
 * The value as a reader receives it.
 *
 * A JSON-backed type is stored as text on SQLite, so its value is parsed the way
 * every read path parses it. Anything that does not parse is returned as stored,
 * for the caller to judge — the same choice the read shape makes.
 */
function decoded(value: unknown, json: boolean): unknown {
  if (typeof value !== "string" || !json) return value;
  return parsedJson(value);
}

/**
 * Whether `field` is stored as JSON, as the schema builds its column: a
 * repeater, a named group, `json`, or a plugin type declaring JSON storage.
 * Asked of the one classification the DDL is built from.
 */
export function storesJson(field: FieldDefinition): boolean {
  return classifyFieldKind(field, "codeFirst") === "json";
}

/** `value` parsed as JSON, or as it is where it does not parse. */
function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * A read outside the scope its caller was given, named rather than answered.
 *
 * `invalidInput`, because what is wrong is the caller's argument — a plugin
 * naming a field its scope does not cover — and its author needs the sentence
 * that says which; the names in it are the ones that code passed.
 */
function refused(
  target: RefusedTarget,
  only: string,
  why: string
): NextlyError {
  const document = "single" in target ? target.single : target.collection;
  const named =
    target.field === undefined ? document : `${document}.${target.field}`;
  return NextlyError.invalidInput({
    message: `"${named}" cannot be read here: it ${why}.${only === "" ? "" : ` ${only}`}`,
    logContext: { ...target, only },
  });
}

/** What a refusal names: the document, and the field where there is one. */
type RefusedTarget = DistributiveOmit<PluginStoredValueTarget, "field"> & {
  readonly field?: string;
};

/** What "nothing stored" hashes as: distinct from the canonical JSON of any value. */
const ABSENT_HASH_INPUT = "\u0000absent";

/**
 * The fingerprint of one stored value, for telling whether it changed: the
 * SHA-256 of its canonical JSON, as hex.
 *
 * Two reads of one value must agree however the database hands it back:
 * PostgreSQL's `jsonb` and MySQL's `JSON` reorder an object's keys, so every
 * object's keys are sorted before hashing. Arrays keep their order, which is
 * part of what a document means. Nothing stored and a stored `null` hash
 * alike: a main-row column holding NULL and a language row holding nothing
 * both store nothing.
 *
 * The one hash a conditional write is judged by, on both sides: the writer
 * hashes what it read, and the write path hashes what it reads again under
 * the row lock ({@link storedExpectationRefusal}).
 */
export function storedValueHash(stored: PluginStoredValue): Promise<string> {
  const text =
    stored.kind === "value" &&
    stored.value !== null &&
    stored.value !== undefined
      ? (canonicalJson(stored.value) ?? "null")
      : ABSENT_HASH_INPUT;
  return Promise.resolve(createHash("sha256").update(text).digest("hex"));
}

/**
 * `value` as JSON with every object's keys sorted, written from its entries
 * rather than by assigning them to a new object: an own key spelt
 * `__proto__` is then kept as the key it is, where assigning it to an
 * ordinary object would set that object's prototype instead and drop it.
 * Otherwise as `JSON.stringify` writes it: a value with `toJSON` as that
 * answers, an `undefined` member left out and an `undefined` item as `null`.
 */
function canonicalJson(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const own = jsonOf(value);
  if (own !== value) return canonicalJson(own);
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item) ?? "null").join(",")}]`;
  }
  const members = Object.keys(value)
    .sort()
    .flatMap(key => {
      const text = canonicalJson((value as Record<string, unknown>)[key]);
      return text === undefined ? [] : [`${JSON.stringify(key)}:${text}`];
    });
  return `{${members.join(",")}}`;
}

/** What an object's own `toJSON` answers, or the object where it has none. */
function jsonOf(value: object): unknown {
  const toJson = (value as { toJSON?: unknown }).toJSON;
  return typeof toJson === "function"
    ? (toJson as () => unknown).call(value)
    : value;
}

/** What a conditional write expects to find stored when it takes the row lock. */
export interface StoredExpectation {
  /** The field, at top level or by its path through named groups. */
  readonly field: string;
  /** The form the writer read: the live row, or the working draft's view. */
  readonly form: "published" | "draft";
  /** {@link storedValueHash} of the value the writer read. */
  readonly hash: string;
  /** Refuse the write where a working draft is pending, whatever it holds. */
  readonly noPendingDraft?: boolean;
}

/** The document an expectation is for. */
export interface ExpectedDocument {
  readonly kind: "collection" | "single";
  readonly slug: string;
  /** The entry, for a collection document; a Single has one document per slug. */
  readonly id?: string;
}

/** The document a write path is writing, as it holds the row lock. */
export interface WrittenDocument extends ExpectedDocument {
  /**
   * Whether this very transaction inserted the document's row, as a Single's
   * first write inserts its defaults. The document was absent until then, and
   * what the row holds is the write's own, so it is judged as absent.
   */
  readonly createdHere?: boolean;
}

/** One conditional write's expectation, and whether its write path judged it. */
export interface PinnedExpectation {
  readonly document: ExpectedDocument;
  readonly expect: StoredExpectation;
  /** Set once the expectation held under the row lock of the write's own transaction. */
  checked: boolean;
  /** Every key of the data the write sent. */
  readonly sentKeys: readonly string[];
  /** Set once the write path judged those keys (see {@link refuseUnstoredKeys}). */
  keysJudged?: boolean;
  /**
   * The write is made whole or not at all (see {@link refuseUnlessWhole}).
   * Set for a write made under field rules.
   */
  readonly whole?: WholeWrite;
}

/**
 * What a write made whole sent, and what its write path has done to it so far.
 */
export interface WholeWrite {
  /** Each field the write sent, by name, with {@link storedValueHash} of its value as sent. */
  readonly sent: ReadonlyMap<string, string>;
  /** The fields the write path's field-access pass took out or changed. */
  readonly cut: string[];
  /** Set once {@link refuseUnlessWhole} judged the final payload whole. */
  judged: boolean;
}

/**
 * The whole-write record of `data`, as a conditional write sends it: each
 * field's hash taken now, before the write path (whose passes change nested
 * values in place) has touched it.
 */
export async function wholeWriteOf(
  data: Record<string, unknown>
): Promise<WholeWrite> {
  const sent = new Map<string, string>();
  for (const [name, value] of Object.entries(data)) {
    sent.set(name, await storedValueHash(payloadValueOf(data, name, value)));
  }
  return { sent, cut: [], judged: false };
}

/** A payload's value for `name` as the stored hash compares it. */
function payloadValueOf(
  data: Record<string, unknown>,
  name: string,
  value: unknown = data[name]
): PluginStoredValue {
  return name in data && value !== undefined
    ? { kind: "value", value }
    : { kind: "absent" };
}

/**
 * Expectations by the context object of the one write each is for.
 *
 * Keyed by the object's identity: the writer hands its write a context object
 * of its own, and every write path hands its hooks a copy of the context it
 * was called with, so no other write, a hook's own write to the same document
 * among them, ever carries it. Concurrent writes each carry their own, so an
 * author's save is never judged by what a plugin read. Weak, so a write that
 * never reaches its path leaves nothing behind.
 */
const expectations = new WeakMap<object, PinnedExpectation>();

/** Register `pin` as what the write called with `context` must find stored. */
export function expectStoredValue(
  context: Record<string, unknown>,
  pin: PinnedExpectation
): void {
  expectations.set(context, pin);
}

/**
 * Run `pass`, a write path's one field-access pass over `data` (the data as
 * its hooks so far left it), for the write called with `context`.
 *
 * Field access takes out of an ordinary update, silently, a field the writer
 * may not update, and keeps a denied value inside a container as stored, then
 * writes the rest. For a write made whole, what the pass took out or changed
 * is recorded, and {@link refuseUnlessWhole} refuses the write for it once
 * every hook has run, even where a later hook put the value back. Every other
 * write runs the pass alone, exactly as before.
 */
export async function fieldAccessPass(
  context: Record<string, unknown> | undefined,
  document: ExpectedDocument,
  data: Record<string, unknown>,
  pass: () => Promise<void>
): Promise<void> {
  const whole = wholeWriteFor(context, document);
  if (whole === undefined) {
    await pass();
    return;
  }
  const before = new Map(
    Object.entries(data).map(([name, value]) => [name, JSON.stringify(value)])
  );
  await pass();
  for (const [name, value] of before) {
    if (!(name in data) || JSON.stringify(data[name]) !== value) {
      whole.cut.push(name);
    }
  }
}

/**
 * Refuse with `FORBIDDEN`, before anything is written, a write made whole
 * whose final payload does not hold what it sent; nothing happens for any
 * other write.
 *
 * Called by a write path once with the payload it is about to persist, after
 * every hook has run (the collection's and the field's `beforeChange` last),
 * and before its own shaping, which only serializes. Each field the write
 * sent must be there exactly as sent, compared by {@link storedValueHash},
 * and the field-access pass must have taken nothing out of it: a hook may not
 * change, drop or put back a value the write sent, and a field rule may not
 * strip one. Either way the write would be reported as made while what it
 * sent was not, so it is refused rather than written in part. Refused as
 * forbidden, not as a conflict: reading again changes nothing, since a hook
 * or rule of the site decides it. Only then is the write judged whole, which
 * {@link holdStoredExpectation} requires under the row lock.
 *
 * Every key the write sent is judged, the lifecycle `status` among them, but
 * the {@link WRITE_TRANSPORT_KEYS}, which say how to write and are never
 * stored. So a hook that turns a publish into a draft, or takes the status
 * out, refuses it; and since a write is held as a working draft only when it
 * names no status (`resolveDraftHold`), one that keeps the status it sent is
 * never held as a draft in place of the state it named.
 */
export async function refuseUnlessWhole(
  context: Record<string, unknown> | undefined,
  document: ExpectedDocument,
  data: Record<string, unknown>
): Promise<void> {
  const whole = wholeWriteFor(context, document);
  if (whole === undefined) return;
  const changed: string[] = [];
  for (const [name, hash] of whole.sent) {
    if (WRITE_TRANSPORT_KEYS.has(name)) continue;
    if ((await storedValueHash(payloadValueOf(data, name))) !== hash) {
      changed.push(name);
    }
  }
  const cut = whole.cut.filter(name => whole.sent.has(name));
  if (changed.length > 0 || cut.length > 0) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "conditional-write-not-whole",
        kind: document.kind,
        slug: document.slug,
        ...(document.id === undefined ? {} : { id: document.id }),
        changed,
        cut,
      },
    });
  }
  whole.judged = true;
}

/**
 * The keys a write sends that say how to write, not what: the version it was
 * read at (`_rev`) and the overwrite of a save made since (`_overwrite`). The
 * write path reads them at its boundary and stores neither, so a whole write
 * is judged on every other key it sends.
 */
const WRITE_TRANSPORT_KEYS: ReadonlySet<string> = new Set([
  DOCUMENT_VERSION_KEY,
  DOCUMENT_OVERWRITE_KEY,
]);

/**
 * Refuse with `INVALID_INPUT` a conditional write naming a key no update of
 * this entity stores, asked of `keysNoUpdateStores` with the entity's own
 * table and fields: an immutable system column, a column schema hooks
 * contributed, a field stored nowhere, or another spelling of a field kept in
 * its own table. Nothing happens for any other write. The
 * {@link WRITE_TRANSPORT_KEYS} are not among them, being read before the
 * strip and never stored.
 *
 * Called by a write path once its access to the entry has been judged and
 * before any hook runs or anything is written: a caller who may not update
 * the entry is refused by that judgment alike, whatever the data names, so
 * the answer tells them nothing of the table's columns. Only then is the
 * write's data judged, which {@link holdStoredExpectation} requires under the
 * row lock.
 */
export function refuseUnstoredKeys(
  context: Record<string, unknown> | undefined,
  document: ExpectedDocument,
  entity: {
    readonly tableName: string;
    readonly fields: Parameters<typeof keysNoUpdateStores>[3];
  }
): void {
  const pin = context === undefined ? undefined : expectations.get(context);
  if (pin === undefined || !sameDocument(pin.document, document)) return;
  const unstored = keysNoUpdateStores(
    Object.fromEntries(pin.sentKeys.map(key => [key, true])),
    document.kind,
    entity.tableName,
    entity.fields
  ).filter(key => !WRITE_TRANSPORT_KEYS.has(key));
  if (unstored.length > 0) {
    throw NextlyError.invalidInput({
      message: `A conditional write cannot write ${unstored.map(key => `"${key}"`).join(", ")}: an update never stores ${unstored.length === 1 ? "it" : "them"}, so the write would be made in part.`,
    });
  }
  pin.keysJudged = true;
}

/** The whole-write record of the write called with `context`, for this document. */
function wholeWriteFor(
  context: Record<string, unknown> | undefined,
  document: ExpectedDocument
): WholeWrite | undefined {
  const pin = context === undefined ? undefined : expectations.get(context);
  if (pin?.whole === undefined || !sameDocument(pin.document, document)) {
    return undefined;
  }
  return pin.whole;
}

/**
 * Refuse, by throwing, a write whose caller registered an expectation for
 * `context` that no longer holds; nothing happens for any other write. Called
 * by a write path inside its transaction, once it holds the entry's row lock
 * and before it writes, with the context it was called with. The refusal is
 * also kept on `refused`, for a path whose adapter wraps what is thrown out of
 * its transaction.
 */
export async function holdStoredExpectation(
  context: Record<string, unknown> | undefined,
  document: WrittenDocument,
  on: {
    readonly tx: VersionsDbApi & { getDrizzle(): unknown };
    readonly localization: { readonly defaultLocale: string } | undefined;
    readonly locale: string | undefined;
  },
  refused: { refusal?: NextlyError } = {}
): Promise<void> {
  const pin = context === undefined ? undefined : expectations.get(context);
  if (pin === undefined || !sameDocument(pin.document, document)) return;
  // A write whose path never judged the keys it sent, after its access, was
  // never judged at all: refused under the lock, so it rolls back.
  if (pin.keysJudged !== true) {
    refused.refusal = NextlyError.internal({
      logContext: {
        reason: "conditional-write-keys-not-judged",
        kind: document.kind,
        slug: document.slug,
      },
    });
    throw refused.refusal;
  }
  // A write that must be made whole, whose path never judged its final
  // payload through `refuseUnlessWhole`, was never judged whole: refused
  // under the lock, so it rolls back rather than landing unjudged.
  if (pin.whole !== undefined && !pin.whole.judged) {
    refused.refusal = NextlyError.internal({
      logContext: {
        reason: "conditional-write-fields-not-judged",
        kind: document.kind,
        slug: document.slug,
      },
    });
    throw refused.refusal;
  }
  refused.refusal = await storedExpectationRefusal(
    pin,
    {
      db: on.tx,
      executor: on.tx.getDrizzle(),
      defaultLocale: on.localization?.defaultLocale ?? null,
    },
    on.locale,
    document.createdHere === true
  );
  if (refused.refusal !== undefined) throw refused.refusal;
}

/** Whether a write is to the document an expectation was made for. */
function sameDocument(
  expected: ExpectedDocument,
  written: ExpectedDocument
): boolean {
  return (
    expected.kind === written.kind &&
    expected.slug === written.slug &&
    (written.kind === "single" || expected.id === written.id)
  );
}

/**
 * The refusal of a write whose writer read something other than what is
 * stored now, or `undefined` where the expectation holds.
 *
 * Called by a write path inside its transaction, once it holds the entry's
 * row lock and before it writes: the lock is what every writer of the
 * document takes first, so nothing can change the value between this read and
 * the write. On PostgreSQL and MySQL that lock is `SELECT ... FOR UPDATE`; on
 * SQLite the write transaction already holds the database's one writer. Read
 * on `connection`, the transaction's own, in the write's language.
 *
 * Refused as a conflict: the caller reads the document again and decides
 * again. A write that publishes asks `noPendingDraft` too, because a draft
 * that leaves this field alone reads the same here and would still be put
 * live by the publish.
 */
async function storedExpectationRefusal(
  pin: PinnedExpectation,
  connection: StoredFieldConnection,
  locale: string | undefined,
  createdHere: boolean
): Promise<NextlyError | undefined> {
  // A row this transaction inserted is judged as the document stood before
  // it: not stored, as a read made then answered. Read back, its generated
  // defaults would never match the absence the writer read.
  const read = createdHere
    ? notStored([pin.expect.field])
    : await readStoredFieldsOn(
        connection,
        EVERY_FIELD,
        expectedRead(pin, locale),
        { askDraft: pin.expect.noPendingDraft === true }
      );
  const cause = await stalenessOf(pin.expect, read);
  if (cause === undefined) {
    pin.checked = true;
    return undefined;
  }
  return staleConflict(pin, cause, locale);
}

/** Why a write's writer read something other than what is stored now. */
type StaleCause = "stored-value-changed" | "working-draft-pending";

/** The read an expectation is judged by: its one field, form and language. */
function expectedRead(
  { document, expect }: PinnedExpectation,
  locale: string | undefined
): StoredFieldsTarget {
  return {
    ...(document.kind === "single"
      ? { single: document.slug }
      : { collection: document.slug, id: document.id ?? "" }),
    fields: [expect.field],
    form: expect.form,
    ...(locale === undefined ? {} : { locale }),
  };
}

/**
 * Whether what is stored now still answers the expectation: the field's
 * hash, then, where it was asked, the absence of a pending working draft.
 */
async function stalenessOf(
  expect: StoredExpectation,
  read: StoredFieldsRead
): Promise<StaleCause | undefined> {
  const now = await storedValueHash(
    read.values.get(expect.field) ?? { kind: "absent" }
  );
  if (now !== expect.hash) return "stored-value-changed";
  return expect.noPendingDraft === true && read.workingDraft
    ? "working-draft-pending"
    : undefined;
}

/** The conflict a stale write is refused with, naming what it expected. */
function staleConflict(
  { document, expect }: PinnedExpectation,
  cause: StaleCause,
  locale: string | undefined
): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message:
      "This content changed after it was read, so the write was not made. Read it again and decide again.",
    logContext: {
      cause,
      kind: document.kind,
      slug: document.slug,
      ...(document.id === undefined ? {} : { id: document.id }),
      field: expect.field,
      form: expect.form,
      ...(locale === undefined ? {} : { locale }),
    },
  });
}

/**
 * The forms a stored read is made in. `published` reads the live row; `draft`
 * reads what an editor's preview shows, the pending working draft where there
 * is one. A request's form is parsed against these where it arrives, and every
 * branch on a form asks {@link showsUnpublished}, so no third value can slip
 * between two comparisons that each assumed the other form.
 */
export const STORED_FORMS = ["published", "draft"] as const;

/** A form a stored read is made in. */
export type StoredForm = (typeof STORED_FORMS)[number];

/**
 * Whether `form` shows unpublished work: the pending working draft, which only
 * a person who may update the document is shown, as a preview is.
 *
 * Exhaustive, and failing closed: a value naming neither form is refused
 * rather than read as either, because a form no branch recognises is one no
 * gate was asked about.
 */
export function showsUnpublished(form: StoredForm): boolean {
  switch (form) {
    case "draft":
      return true;
    case "published":
      return false;
    default:
      return unknownForm(form);
  }
}

/** Refuses a form no branch names; `never` holds every form to a branch. */
function unknownForm(form: never): never {
  throw NextlyError.internal({
    logContext: { reason: "stored-form-unknown", form: String(form) },
  });
}

/**
 * A Single's first write's read of its row inside its transaction, for the
 * write called with `context`: none where it is not stored yet. A write
 * without a conditional write's expectation reads it with `plainRead`, the
 * write path's own read, as it always has.
 *
 * A write carrying an expectation reads under locks. On MySQL a transaction's
 * first plain read fixes the snapshot every later plain read answers from, and
 * the expectation is read plainly after the row lock; read before that lock,
 * the row could change under a snapshot the expectation would then trust. A
 * locking read takes its lock at once and fixes no snapshot, so the
 * expectation's snapshot is taken under the lock.
 *
 * The Single's registry row is locked first: it always exists, so the lock is
 * on that one record, and two first writes of one Single are made one after
 * the other. The second then finds the row the first inserted and judges its
 * expectation against it, rather than both locking the empty table's gap and
 * deadlocking on MySQL, or both inserting a row on PostgreSQL, where a lock
 * on no row holds nothing. An insert-if-absent cannot do this: a Single's
 * table has no key two first rows would collide on. The order, registry row
 * then the document's row, is the one every history write and deletion takes
 * (`history-locks`).
 *
 * An entry's update takes its row lock as its transaction's first
 * statement, so it reads nothing before the lock.
 */
export async function firstWriteRead<T>(
  tx: VersionsDbApi,
  single: { readonly id: string; readonly tableName: string },
  context: Record<string, unknown> | undefined,
  plainRead: () => Promise<T | null>
): Promise<T | null | undefined> {
  if (context === undefined || !expectations.has(context)) return plainRead();
  await tx.select("dynamic_singles", {
    columns: ["id"],
    where: { and: [{ column: "id", op: "=", value: single.id }] },
    limit: 1,
    forUpdate: true,
  });
  return (
    await tx.select<T>(single.tableName, { limit: 1, forUpdate: true })
  )[0];
}
