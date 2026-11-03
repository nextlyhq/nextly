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
 * It reads ONE field and returns only that field's value. What a caller may
 * name is decided by the caller of this module; nothing here widens it.
 *
 * @module domains/collections/services/stored-field-read
 */
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
 * Read one stored field of one entry or single, as `form` holds it: a
 * top-level field, or one inside named groups, named by its path
 * (`hero.body`).
 *
 * `allowedType` is the only field type this read will return: a field of any
 * other type, or a field the entity does not declare at top level or inside
 * named groups, is refused by name rather than answered, because answering
 * would make the scope the caller set a suggestion.
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
 */
export async function readStoredField(
  connection: StoredFieldConnection,
  allowedType: string,
  target: StoredFieldTarget,
  records: RegistryRecords = registryRecords(connection)
): Promise<PluginStoredValue> {
  const entity = await storedEntity(connection, records, target, allowedType);
  const path = storedFieldPath(entity, target, allowedType);
  const locale = target.locale ?? connection.defaultLocale ?? null;
  // Only a top-level field can be kept per language on its own: a field
  // inside a group is stored in the group's value, and a group kept per
  // language is refused by the path above.
  const perLanguage =
    path.within.length === 0
      ? companionFieldOf(entity, path.column)
      : undefined;

  const row = await storedRow(
    connection,
    entity,
    target,
    path.column,
    perLanguage
  );
  if (row === undefined) return { kind: "absent" };
  const shown = await shownValue(connection, entity, target, {
    id: String(row.id),
    column: path.column,
    stored: row[path.column],
    perLanguage,
    locale,
  });
  const reached =
    shown === undefined ? undefined : valueWithin(shown.value, path.within);
  if (reached === undefined) return { kind: "absent" };
  // Only a column's own value is stored encoded. A value reached inside a
  // group was decoded with the group, and decoding it again would turn a
  // string holding JSON text ("123", "null") into what that text says.
  return {
    kind: "value",
    value:
      path.within.length === 0
        ? decoded(reached.value, allowedType)
        : reached.value,
  };
}

/**
 * Where a stored read's field is kept: the column its top-level field is
 * stored in, and the names that lead from that column's value to the field.
 */
interface StoredFieldPath {
  readonly column: string;
  /** Empty for a top-level field; the group names after the first, then the field's own. */
  readonly within: readonly string[];
}

/**
 * The column `target.field` is read from, refusing a path that does not lead
 * through named groups alone to a field of `allowedType`.
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
  allowedType: string
): StoredFieldPath {
  const refuse = (why: string) => refused(target, allowedType, why);
  const names = target.field.split(".");
  const fields = innermostGroupFields(entity, names.slice(0, -1), refuse);
  const field = fields.find(entry => entry.name === names.at(-1));
  if (field?.type !== allowedType) {
    throw refuse("is not a field of that type");
  }
  return { column: names[0] ?? target.field, within: names.slice(1) };
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
 * The value `target.form` shows: for `draft`, the pending working draft where
 * a preview would show it; otherwise, and where none is shown, the stored
 * value, read from the language's own companion row for a field kept per
 * language and from the main row for any other.
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
  }
): Promise<{ value: unknown } | undefined> {
  const drafted =
    target.form === "draft"
      ? await workingDraftValue(connection, entity, at.column, at.id, at.locale)
      : undefined;
  if (drafted !== undefined) return drafted;
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
  target: StoredFieldTarget,
  allowedType: string
): Promise<StoredEntity> {
  if ("single" in target) {
    const single = await getService("singleRegistryService").getSingleBySlug(
      target.single,
      connection.executor
    );
    if (single === null) throw refused(target, allowedType, "names no single");
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
    throw refused(target, allowedType, "names no collection");
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
 * which keys the companion rows and the working draft, and `column` where the
 * main row holds it.
 */
async function storedRow(
  connection: StoredFieldConnection,
  entity: StoredEntity,
  target: StoredFieldTarget,
  column: string,
  perLanguage: CompanionField | undefined
): Promise<Record<string, unknown> | undefined> {
  const rows = await connection.db.select<Record<string, unknown>>(
    entity.tableName,
    {
      // Only what is asked for: a row can hold other large values, and a
      // composition reads up to a hundred definitions in one save.
      columns: perLanguage === undefined ? ["id", column] : ["id"],
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

/**
 * `column`'s value in the pending working draft, where a preview would show it.
 *
 * `undefined` where the preview would show the stored value: the document has
 * no draft lifecycle, none is pending, or the shared rule declines to overlay
 * it. A draft that does not carry the column leaves the stored value standing,
 * which is what promoting it would do. A document kept per language keeps a
 * draft per language, so the one looked for is `locale`'s.
 */
async function workingDraftValue(
  connection: StoredFieldConnection,
  entity: StoredEntity,
  column: string,
  id: string,
  locale: string | null
): Promise<{ value: unknown } | undefined> {
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

  const snapshot = draft.snapshot;
  if (typeof snapshot !== "object" || snapshot === null) return undefined;
  if (!Object.hasOwn(snapshot, column)) return undefined;
  return { value: (snapshot as Record<string, unknown>)[column] };
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
  target: StoredFieldTarget,
  allowedType: string,
  why: string
): NextlyError {
  return NextlyError.invalidInput({
    message: `"${"single" in target ? target.single : target.collection}.${target.field}" cannot be read here: it ${why}.${allowedType === "" ? "" : ` Only top-level "${allowedType}" fields, or ones inside named groups, can be read.`}`,
    logContext: { ...target, allowedType },
  });
}
