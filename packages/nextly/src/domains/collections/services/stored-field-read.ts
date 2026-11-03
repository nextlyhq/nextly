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
 * value and computed a replacement from it pins what it read
 * ({@link runWithStoredExpectation}), and the write path reads the value again
 * HERE, on its own transaction, once it holds the entry's row lock
 * ({@link storedExpectationRefusal}). The read the writer made and the read
 * the write path makes are the same read, and both are hashed by
 * {@link storedValueHash}, so the two can only disagree when the stored value
 * did.
 *
 * @module domains/collections/services/stored-field-read
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { and, eq } from "drizzle-orm";

import type {
  DynamicCollectionRecord,
  FieldDefinition,
} from "@nextly/schemas/dynamic-collections";

import type { FieldConfig } from "../../../collections/fields/types";
import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import type {
  PluginStoredValue,
  PluginStoredValueTarget,
} from "../../../plugins/contributions";
import type { EntryWriteContext } from "../../../shared/lib/entry-validation";
import type { LocalizedFieldRef } from "../../i18n/companion-join";
import {
  buildCompanionSchema,
  type CompanionSchema,
} from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  resolveCompanionSchemaReadiness,
} from "../../i18n/runtime/companion-readiness";
import { getFieldType } from "../../schema/field-types/field-type-registry";
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
  /** Whether a field declared with `type` is one this read may answer. */
  admits(type: string): boolean;
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
    admits: type => type === allowedType,
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
  options: { records?: RegistryRecords; askDraft?: boolean } = {}
): Promise<StoredFieldsRead> {
  const records = options.records ?? registryRecords(connection);
  const fields = [...new Set(target.fields)];
  const entity = await storedEntity(connection, records, target, scope);
  const paths = fields.map(field => ({
    field,
    path: storedFieldPath(entity, { ...target, field }, scope),
  }));
  const locale = target.locale ?? connection.defaultLocale ?? null;
  // Only a top-level field can be kept per language on its own: a field
  // inside a group is stored in the group's value, and a group kept per
  // language is refused by the path above.
  const placed = paths.map(({ field, path }) => ({
    field,
    path,
    perLanguage:
      path.within.length === 0
        ? companionFieldOf(entity, path.column)
        : undefined,
  }));

  const row = await storedRow(
    connection,
    entity,
    target,
    placed
      .filter(({ perLanguage }) => perLanguage === undefined)
      .map(({ path }) => path.column)
  );
  if (row === undefined) {
    return {
      found: false,
      values: new Map(fields.map(field => [field, { kind: "absent" }])),
      workingDraft: false,
    };
  }
  const id = String(row.id);
  const draft =
    target.form === "draft" || options.askDraft === true
      ? await pendingWorkingDraft(connection, entity, id, locale)
      : undefined;

  const values = new Map<string, PluginStoredValue>();
  for (const { field, path, perLanguage } of placed) {
    const shown = await shownValue(
      connection,
      entity,
      { ...target, field },
      {
        id,
        column: path.column,
        stored: row[path.column],
        perLanguage,
        locale,
        draft: target.form === "draft" ? draft : undefined,
      }
    );
    const reached =
      shown === undefined ? undefined : valueWithin(shown.value, path.within);
    // Only a column's own value is stored encoded. A value reached inside a
    // group was decoded with the group, and decoding it again would turn a
    // string holding JSON text ("123", "null") into what that text says.
    values.set(
      field,
      reached === undefined
        ? { kind: "absent" }
        : {
            kind: "value",
            value:
              path.within.length === 0
                ? decoded(reached.value, path.type)
                : reached.value,
          }
    );
  }
  return { found: true, values, workingDraft: draft !== undefined };
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
  readonly type: string;
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
  if (field === undefined || !scope.admits(field.type)) {
    throw refuse("is not a field of that type");
  }
  const why = scope.refusal?.(entity, column);
  if (why !== undefined) throw refuse(why);
  return { column, within: names.slice(1), type: field.type };
}

/** A named group: a `group` field that declares fields of its own. */
type NamedGroup = FieldDefinition & { fields: FieldDefinition[] };

/**
 * The fields of the innermost group `groups` names, walking from the entity's
 * top level; the entity's own fields for a top-level read. Refused with
 * `refuse`'s error where a name is not a named group, or names one kept per
 * language.
 */
function innermostGroupFields(
  entity: StoredEntity,
  groups: readonly string[],
  refuse: (why: string) => NextlyError
): readonly FieldDefinition[] {
  let fields: readonly FieldDefinition[] = entity.fields;
  for (const [depth, name] of groups.entries()) {
    const group = namedGroupIn(fields, name);
    if (group === undefined) throw refuse("is not inside named groups alone");
    if (groupKeptPerLanguage(entity, group, depth)) {
      throw refuse("is inside a group kept per language");
    }
    fields = group.fields;
  }
  return fields;
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
    : entity.localized && group.localized === true;
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
 * which is what promoting it would do.
 */
async function shownValue(
  connection: StoredFieldConnection,
  entity: StoredEntity,
  target: StoredFieldTarget,
  at: {
    readonly id: string;
    /** The column read: the field's own, or the top-level group holding it. */
    readonly column: string;
    readonly stored: unknown;
    readonly perLanguage: CompanionField | undefined;
    readonly locale: string | null;
    readonly draft: PendingDraft | undefined;
  }
): Promise<{ value: unknown } | undefined> {
  const snapshot = at.draft?.snapshot;
  if (
    typeof snapshot === "object" &&
    snapshot !== null &&
    Object.hasOwn(snapshot, at.column)
  ) {
    return { value: (snapshot as Record<string, unknown>)[at.column] };
  }
  return at.perLanguage === undefined
    ? { value: at.stored }
    : languageValue(connection, at.perLanguage, at.id, at.locale, target);
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
  };
}

/** The select surface a companion read needs, on a Drizzle executor. */
interface CompanionSelect {
  select(projection: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): Promise<{ value?: unknown }[]>;
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
  if (!entity.localized) return undefined;
  const companion = buildCompanionSchema({
    slug: entity.slug,
    tableName: entity.tableName,
    fields: entity.fields as unknown as { name: string; type: string }[],
    dialect: getService("adapter").dialect,
    status: entity.status,
  });
  const field = companion?.localizedFields.find(entry => entry.name === name);
  return companion === null || field === undefined
    ? undefined
    : { companion, field };
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

/**
 * The field's value in one language, as its companion row holds it, with no
 * fallback to another language; `undefined` where that language stores none.
 *
 * Inside a write's transaction the remembered readiness verdict is read and
 * never resolved: resolving queries, and on PostgreSQL a query against a
 * missing relation aborts the transaction. A companion not known to be ready
 * is refused rather than answered as empty, which a caller could not tell from
 * a language that stores nothing.
 */
async function languageValue(
  connection: StoredFieldConnection,
  { companion, field }: CompanionField,
  id: string,
  locale: string | null,
  target: StoredFieldTarget
): Promise<{ value: unknown } | undefined> {
  if (locale === null) {
    throw refused(target, "", "is kept per language, and no language is set");
  }
  const adapter = getService("adapter");
  const readiness =
    connection.executor === undefined
      ? await resolveCompanionSchemaReadiness(adapter, companion)
      : cachedCompanionReadiness(adapter, companion.companionTableName);
  if (readiness !== "ready") {
    throw NextlyError.serviceUnavailable({
      // Not a refusal of the caller's request: the language store is still
      // being set up, so a reader can tell "cannot read yet" from an error.
      publicMessage: "This language's content can't be read yet.",
      logMessage: `"${"single" in target ? target.single : target.collection}.${target.field}" is kept per language, and that store is not ready.`,
    });
  }
  // Only the field asked for, of the one row for this entry and language: a
  // translation row can hold every other large value of the page, and a save
  // reads this for each stored form. Read as stored, whatever the language's
  // status, as the main row is for a field kept there.
  const table = companion.table as Record<string, unknown>;
  const rows = await (
    (connection.executor ?? adapter.getDrizzle()) as CompanionSelect
  )
    .select({ value: table[field.column] })
    .from(companion.table)
    .where(
      and(eq(table._parent as never, id), eq(table._locale as never, locale))
    )
    .limit(1);
  // No row, or a row holding nothing for the field: either way the language
  // stores nothing.
  const value = rows[0]?.value;
  return value === null || value === undefined ? undefined : { value };
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
function decoded(value: unknown, type: string): unknown {
  if (typeof value !== "string" || getFieldType(type)?.storage !== "json") {
    return value;
  }
  return parsedJson(value);
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
export async function storedValueHash(
  stored: PluginStoredValue
): Promise<string> {
  const text =
    stored.kind === "absent" ||
    stored.value === null ||
    stored.value === undefined
      ? ABSENT_HASH_INPUT
      : canonicalJson(stored.value);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** `value` as JSON with every object's keys sorted. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
      return inner;
    }
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(inner).sort()) {
      sorted[key] = (inner as Record<string, unknown>)[key];
    }
    return sorted;
  });
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

/** The document a pinned expectation is for. */
export interface ExpectedDocument {
  readonly kind: "collection" | "single";
  readonly slug: string;
  /**
   * The entry, for a collection document. A Single is one document per slug,
   * so it is matched on the slug alone, as a write receipt is.
   */
  readonly id?: string;
}

/** One conditional write's expectation, pinned for the length of the write. */
export interface PinnedExpectation {
  readonly document: ExpectedDocument;
  readonly expect: StoredExpectation;
  /**
   * Set by the first write to the document made while pinned. A later one in
   * the same call (a hook writing the document it reacts to, say) is not the
   * write the expectation was made for, and is not judged by it.
   */
  claimed: boolean;
  /** Set once the expectation held under the row lock of the write's own transaction. */
  checked: boolean;
}

/**
 * Pinned expectations, one per conditional write. `AsyncLocalStorage`, as a
 * write receipt is pinned: writes run concurrently, and a module variable
 * would judge an author's own save by what a plugin read.
 */
const expectationScope = new AsyncLocalStorage<PinnedExpectation>();

/** Run `write` with `pin` as what its write path must find stored. */
export function runWithStoredExpectation<T>(
  pin: PinnedExpectation,
  write: () => Promise<T>
): Promise<T> {
  return expectationScope.run(pin, write);
}

/**
 * The expectation pinned for a write to `document`, claimed for it; or
 * `undefined` where none is pinned for that document or it is already
 * claimed. A write path claims before anything it runs can write, and checks
 * the claimed expectation under its row lock.
 */
export function claimStoredExpectation(
  document: ExpectedDocument
): PinnedExpectation | undefined {
  const pin = expectationScope.getStore();
  if (pin === undefined || pin.claimed) return undefined;
  const pinned = pin.document;
  if (pinned.kind !== document.kind || pinned.slug !== document.slug) {
    return undefined;
  }
  if (document.kind === "collection" && pinned.id !== document.id) {
    return undefined;
  }
  pin.claimed = true;
  return pin;
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
export async function storedExpectationRefusal(
  pin: PinnedExpectation,
  connection: StoredFieldConnection,
  locale: string | undefined
): Promise<NextlyError | undefined> {
  const { document, expect } = pin;
  const read = await readStoredFieldsOn(
    connection,
    EVERY_FIELD,
    {
      ...(document.kind === "single"
        ? { single: document.slug }
        : { collection: document.slug, id: document.id ?? "" }),
      fields: [expect.field],
      form: expect.form,
      ...(locale === undefined ? {} : { locale }),
    },
    { askDraft: expect.noPendingDraft === true }
  );
  const now = await storedValueHash(
    read.values.get(expect.field) ?? { kind: "absent" }
  );
  const changed =
    now !== expect.hash
      ? "stored-value-changed"
      : expect.noPendingDraft === true && read.workingDraft
        ? "working-draft-pending"
        : undefined;
  if (changed === undefined) {
    pin.checked = true;
    return undefined;
  }
  return NextlyError.conflict({
    reason: "state",
    message:
      "This content changed after it was read, so the write was not made. Read it again and decide again.",
    logContext: {
      cause: changed,
      kind: document.kind,
      slug: document.slug,
      ...(document.id === undefined ? {} : { id: document.id }),
      field: expect.field,
      form: expect.form,
      ...(locale === undefined ? {} : { locale }),
    },
  });
}
