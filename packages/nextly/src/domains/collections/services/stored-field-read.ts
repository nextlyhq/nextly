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
  connection: StoredFieldConnection;
}): EntryWriteContext {
  const records = registryRecords(args.connection);
  return {
    kind: args.kind,
    slug: args.slug,
    ...(args.id === undefined ? {} : { id: args.id }),
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
 * Read one stored top-level field of one entry, as `form` holds it.
 *
 * `allowedType` is the only field type this read will return: a field of any
 * other type, or a field the entity does not declare at top level, is refused
 * by name rather than answered, because answering would make the scope the
 * caller set a suggestion. A localized field is refused the same way: its
 * values live per language in a companion row, and answering from the main row
 * would return something no reader receives.
 */
export async function readStoredField(
  connection: StoredFieldConnection,
  allowedType: string,
  target: StoredFieldTarget,
  records: RegistryRecords = registryRecords(connection)
): Promise<PluginStoredValue> {
  const entity = await storedEntity(records, target, allowedType);
  const field = entity.fields.find(entry => entry.name === target.field);
  if (field === undefined || field.type !== allowedType) {
    throw refused(target, allowedType, "is not a field of that type");
  }
  if ((field as { localized?: unknown }).localized === true) {
    throw refused(target, allowedType, "is localized");
  }

  const rows = await connection.db.select<Record<string, unknown>>(
    entity.tableName,
    {
      // The one column asked for: a row can hold other large values, and a
      // composition reads up to a hundred definitions in one save.
      columns: [target.field],
      where: { and: [{ column: "id", op: "=", value: target.id }] },
      limit: 1,
    }
  );
  const row = rows[0];
  if (row === undefined) return { kind: "absent" };
  const live: PluginStoredValue = {
    kind: "value",
    value: decoded(row[target.field], allowedType),
  };
  if (target.form === "published") return live;

  const drafted = await workingDraftValue(connection, entity, target);
  return drafted === undefined
    ? live
    : { kind: "value", value: decoded(drafted.value, allowedType) };
}

/** What a read needs to know about the entity it reads from. */
interface StoredEntity {
  readonly slug: string;
  /** The registry record, which carries the draft lifecycle's switches. */
  readonly record: unknown;
  readonly fields: readonly FieldDefinition[];
  readonly tableName: string;
}

/**
 * The collection's REGISTRY record, read on the same connection.
 *
 * The registry rather than a metadata service, which adds the entry form's
 * synthetic fields: a column the table does not have is not a value anyone
 * stored.
 */
async function storedEntity(
  records: RegistryRecords,
  target: StoredFieldTarget,
  allowedType: string
): Promise<StoredEntity> {
  const collection = await records(target.collection);
  if (collection === null) {
    throw refused(target, allowedType, "names no collection");
  }
  return {
    slug: target.collection,
    record: collection,
    fields: collectionFields(collection),
    tableName: collectionTableName(collection, target.collection),
  };
}

/**
 * The field's value in the pending working draft, where a preview would show it.
 *
 * `undefined` where the preview would show the live row: the document has no
 * draft lifecycle, none is pending, or the shared rule declines to overlay it.
 * A draft that does not carry the field leaves the live value standing, which
 * is what promoting it would do.
 */
async function workingDraftValue(
  connection: StoredFieldConnection,
  entity: StoredEntity,
  target: StoredFieldTarget
): Promise<{ value: unknown } | undefined> {
  const facts = draftDocumentFacts({
    ...(entity.record as DraftDocumentConfig),
    localized: (entity.record as { localized?: boolean }).localized,
  });
  const fields = entity.fields as unknown as FieldConfig[];
  const overlay = (
    componentSchemas: Parameters<
      typeof resolveDraftOverlay
    >[0]["componentSchemas"]
  ) =>
    resolveDraftOverlay({
      ...facts,
      fields,
      componentSchemas,
      includeWorkingDraft: true,
      // As the system: this judges what a preview renders, not who may see it.
      callerMayEdit: true,
      requestLocale: null,
      defaultLocale: connection.defaultLocale,
    });

  // The cheap half first, as the preview read does: with no schemas the rule can
  // only be more permissive, so a refusal here is final.
  const provisional = overlay(null);
  if (!provisional.overlay) return undefined;

  const draft = await new VersionsRepository(connection.db).findWorkingDraft(
    { scopeKind: "collection", scopeSlug: entity.slug, entryId: target.id },
    provisional.draftLocale
  );
  if (draft === undefined) return undefined;

  // The confirming half, against resolved schemas: a draft nothing could promote
  // is not one the preview shows.
  if (!overlay(await resolveComponentSchemas(fields)).overlay) return undefined;

  const snapshot = draft.snapshot;
  if (typeof snapshot !== "object" || snapshot === null) return undefined;
  if (!Object.hasOwn(snapshot, target.field)) return undefined;
  return { value: (snapshot as Record<string, unknown>)[target.field] };
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
    message: `"${target.collection}.${target.field}" cannot be read here: it ${why}. Only top-level "${allowedType}" fields can be read.`,
    logContext: { ...target, allowedType },
  });
}
