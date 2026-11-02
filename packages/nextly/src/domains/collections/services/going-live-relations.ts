/**
 * A collection document's components and junction many-to-many relationships,
 * as a publish judges them.
 *
 * Neither sits on the document's row: a component's values live in tables of
 * its own, and a many-to-many relationship in a junction. A publish judges the
 * stored row in update mode, where an absent key is not judged, so a document
 * built from the row and its translations alone put a required component or
 * relationship missing from storage live unchecked. These are read as stored,
 * every such field with a key of its own, and the write's own values laid over
 * them.
 *
 * Read for many documents at once where a publish judges many: a batch, a bulk
 * publish, a release's readiness. One read per field for the whole batch,
 * never one per document.
 *
 * @module domains/collections/services/going-live-relations
 */

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { isFieldGroupField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import { NextlyError } from "../../../errors";
import type {
  CollectionRelationshipService,
  RelationshipDbExecutor,
} from "../../../services/collections/collection-relationship-service";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import { mergeComponentPatches } from "../../versions/draft-components";
import type { ComponentSchemas } from "../../versions/restore-snapshot";

/** A document's top-level component values and many-to-many ids, as stored. */
export interface StoredRelations {
  components: Record<string, unknown>;
  manyToMany: Record<string, string[]>;
}

/** Reads these documents' stored relations, keyed by document id. */
export type StoredRelationsLoad = (
  entryIds: readonly string[]
) => Promise<Map<string, StoredRelations>>;

const NONE: StoredRelations = { components: {}, manyToMany: {} };

/**
 * The stored relations of a batch of one collection's documents, read for all
 * of them the first time any is asked for, once per language.
 *
 * A document the batch writes after that read is read again on its own when
 * it is next asked for (`written`): a batch may name one document twice, and
 * the second write is judged on what the first left. A document outside the
 * batch is read on its own.
 *
 * @internal
 */
export class GoingLiveRelationsBatch {
  private readonly entryIds: readonly string[];
  private readonly byLanguage = new Map<
    string,
    Promise<Map<string, StoredRelations>>
  >();
  private readonly rewritten = new Set<string>();

  constructor(entryIds: readonly string[]) {
    this.entryIds = [...new Set(entryIds)];
  }

  /** The batch has written this document since its relations were read. */
  written(entryId: string): void {
    this.rewritten.add(entryId);
  }

  /**
   * One document's stored relations in `language`, through `load`, which
   * reads on the connection the judgement runs on.
   */
  async read(
    entryId: string,
    language: string | undefined,
    load: StoredRelationsLoad
  ): Promise<StoredRelations> {
    if (this.rewritten.has(entryId) || !this.entryIds.includes(entryId)) {
      return (await load([entryId])).get(entryId) ?? NONE;
    }
    // `undefined` is the default resolution, a language of its own here.
    const key = language === undefined ? "" : `:${language}`;
    let batch = this.byLanguage.get(key);
    if (batch === undefined) {
      batch = load(this.entryIds);
      this.byLanguage.set(key, batch);
    }
    return (await batch).get(entryId) ?? NONE;
  }
}

/**
 * These documents' stored relations, one read per component field and one per
 * many-to-many field for them all.
 *
 * Every component field and every many-to-many field gets a key: the
 * component read gives a component missing from storage its empty value
 * (`null` for one, `[]` for a repeatable component or a zone), and the
 * junction read gives a document with no links `[]`. A read that fails
 * refuses rather than reading as empty, and the ids are every stored one, a
 * target since unpublished included, as the write itself reads them.
 *
 * Refused where the collection has component fields and no field-group
 * service is registered: its components cannot be read, and a document judged
 * without them would go live unchecked.
 */
export async function readStoredRelations(
  args: StoredRelationsRead
): Promise<Map<string, StoredRelations>> {
  const components = await readStoredComponents(args);
  const manyToMany = await readStoredManyToMany(args);
  return new Map(
    args.entryIds.map(id => [
      id,
      {
        components: components.get(id) ?? {},
        manyToMany: manyToMany.get(id) ?? {},
      },
    ])
  );
}

/** What reading a batch's stored relations needs. */
interface StoredRelationsRead {
  entryIds: readonly string[];
  collectionName: string;
  /** The collection's resolved table: a custom `dbName` is not the slug's. */
  parentTable: string;
  fields: readonly FieldDefinition[];
  manyToManyFields: readonly FieldDefinition[];
  /** Read in this language exactly, with no fallback; absent, the default resolution. */
  language: string | undefined;
  /** The transaction's executor, where the judgement runs inside one. */
  executor?: unknown;
  fieldGroups:
    | Pick<FieldGroupDataService, "populateComponentDataMany">
    | undefined;
  relationships: Pick<
    CollectionRelationshipService,
    "fetchManyToManyTargetIdsOf"
  >;
}

/**
 * Each document's top-level component values, keyed by document id: one
 * call for the whole batch, which reads each component field once.
 */
async function readStoredComponents(
  args: StoredRelationsRead
): Promise<Map<string, Record<string, unknown>>> {
  const componentFields = args.fields.filter(field =>
    isFieldGroupField(field as unknown as FieldConfig)
  );
  if (componentFields.length === 0) return new Map();
  if (args.fieldGroups === undefined) {
    throw NextlyError.configuration({
      logMessage:
        "A collection with component fields cannot be published: no field-group service is registered, so its components cannot be read and judged. Boot with the field-group services registered.",
      logContext: {
        collection: args.collectionName,
        fields: componentFields.map(field => field.name),
      },
    });
  }
  const populated = await args.fieldGroups.populateComponentDataMany({
    entries: args.entryIds.map(id => ({ id })),
    parentTable: args.parentTable,
    fields: args.fields as unknown as FieldConfig[],
    depth: 0,
    strict: true,
    ...(args.executor === undefined ? {} : { executor: args.executor }),
    ...(args.language === undefined
      ? {}
      : { locale: args.language, fallbackLocale: false as const }),
  });
  return new Map(
    populated.map(entry => [
      String(entry.id),
      Object.fromEntries(
        componentFields
          .filter(field => entry[field.name] !== undefined)
          .map(field => [field.name, entry[field.name]])
      ),
    ])
  );
}

/**
 * Each document's many-to-many ids, keyed by document id: one junction read
 * per field for the whole batch, a document with no links holding `[]`.
 */
async function readStoredManyToMany(
  args: StoredRelationsRead
): Promise<Map<string, Record<string, string[]>>> {
  const byDocument = new Map<string, Record<string, string[]>>(
    args.entryIds.map(id => [id, {}])
  );
  for (const field of args.manyToManyFields) {
    const targets = await args.relationships.fetchManyToManyTargetIdsOf(
      args.collectionName,
      args.entryIds,
      field,
      args.executor as RelationshipDbExecutor | undefined
    );
    for (const [id, links] of byDocument) {
      links[field.name] = targets.get(id) ?? [];
    }
  }
  return byDocument;
}

/**
 * The language rules a publish judges in, with a required top-level component
 * enforced for the default language only, as a translated field's `required`
 * is: one finished language can go live while another is incomplete. The
 * validator relaxes `required` for the names it is given outside the default
 * language, so the components' names join the translated fields'.
 */
export function componentsRequiredInDefaultLanguage<
  T extends {
    localizedFieldNames: ReadonlySet<string>;
    enforceLocalizedRequired: boolean;
  },
>(context: T, fields: readonly FieldDefinition[]): T {
  if (context.enforceLocalizedRequired) return context;
  const components = fields
    .filter(field => isFieldGroupField(field as unknown as FieldConfig))
    .map(field => field.name);
  if (components.length === 0) return context;
  return {
    ...context,
    localizedFieldNames: new Set([
      ...context.localizedFieldNames,
      ...components,
    ]),
  };
}

/**
 * The values a document goes live with for its components and many-to-many
 * relationships: the stored ones, with the write's own over them. A single
 * component the write patches is merged sub-field by sub-field, as the write
 * merges it; a repeatable component, a zone and a relationship the write
 * names are replaced whole.
 */
export function relationsGoingLive(args: {
  stored: StoredRelations;
  fields: readonly FieldDefinition[];
  componentSchemas: ComponentSchemas | null;
  /** The write's own component values. */
  components: Record<string, unknown>;
  /** The write's own many-to-many ids. */
  manyToMany: Record<string, string[]>;
}): Record<string, unknown> {
  return {
    ...mergeComponentPatches(
      args.stored.components,
      args.components,
      args.fields as unknown as FieldConfig[],
      args.componentSchemas
    ),
    ...args.stored.manyToMany,
    ...args.manyToMany,
  };
}
