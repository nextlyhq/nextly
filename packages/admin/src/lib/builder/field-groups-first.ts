/**
 * The entities not saved yet that a host's save creates before the host.
 *
 * A field group made from a host's field picker, or a collection a template's
 * link needs and the new-entity dialog made too, waits in this tab's unsaved
 * entities until the host is saved. The host's fields may name it, at any
 * depth (a field group by a field-group field, a collection by a link), so
 * the save creates every unsaved entity its fields need before the host's own
 * change, which would otherwise name one the server does not have. One the
 * host made and no field needs any more is let go once the save has landed.
 *
 * @module lib/builder/field-groups-first
 */
import {
  BUILDER_KIND_NOUN,
  type BuilderKind,
} from "@admin/components/features/schema-builder/builder-config";
import { checkAddressAgain } from "@admin/components/features/schema-builder/new-entity/useAddressCheck";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { CreateComponentPayload } from "@admin/services/fieldGroupApi";
import type { CreateCollectionPayload } from "@admin/types/collection";

import {
  collectionCreatePayload,
  fieldGroupCreatePayload,
} from "./create-request";
import { removeUnsavedEntity, type UnsavedEntity } from "./unsaved-entities";

/** The entity being saved, as an unsaved field group names its owner. */
export type FieldGroupHost = NonNullable<UnsavedEntity["ownedBy"]>;

/**
 * A field as far as naming other entities goes, in the editor's shape or the
 * server's: the field group it embeds, the field groups a zone of them
 * offers, the collections it links to, and the fields it holds.
 */
export interface FieldNamingGroups {
  component?: string;
  components?: string[];
  relationTo?: string | readonly string[];
  fields?: readonly FieldNamingGroups[];
}

/** The kinds a field names: a field group it uses, a collection it links to. */
type NamedKind = Extract<BuilderKind, "field-group" | "collection">;

/** One entity a field names, by kind and address, as one key. */
const keyOf = (kind: BuilderKind, address: string) => `${kind}:${address}`;

/**
 * Every entity the fields name, at any depth, in field order, each once: the
 * field groups each field uses, then the collections it links to.
 */
function entitiesNamedBy(fields: readonly FieldNamingGroups[]): string[] {
  const named: string[] = [];
  const name = (kind: NamedKind, address: string) => {
    const key = keyOf(kind, address);
    if (!named.includes(key)) named.push(key);
  };
  const visit = (level: readonly FieldNamingGroups[]) => {
    for (const field of level) {
      if (field.component) name("field-group", field.component);
      for (const address of field.components ?? []) {
        name("field-group", address);
      }
      const links =
        typeof field.relationTo === "string"
          ? [field.relationTo]
          : (field.relationTo ?? []);
      for (const address of links) name("collection", address);
      if (field.fields) visit(field.fields);
    }
  };
  visit(fields);
  return named;
}

/**
 * Of the unsaved entities `held`: the ones `fields` need, which the host's
 * save creates first; and the ones the host made that no field needs, which
 * its save lets go. What an unsaved entity's own fields need is created
 * before it (a collection a field group links to, before the field group),
 * each once, in the order the fields name them; a loop stops where it meets
 * an entity already on the way. The host itself is never one it creates
 * first, though a link of its own names it.
 */
export function fieldGroupsFirst(
  held: readonly UnsavedEntity[],
  fields: readonly FieldNamingGroups[],
  host: FieldGroupHost
): { used: UnsavedEntity[]; unused: UnsavedEntity[] } {
  const hostKey = keyOf(host.kind, host.address);
  const byKey = new Map(
    held
      .map(entity => [keyOf(entity.kind, entity.address), entity] as const)
      .filter(([key]) => key !== hostKey)
  );
  const used: UnsavedEntity[] = [];
  const reached = new Set<string>();
  const visit = (key: string) => {
    const entity = byKey.get(key);
    if (!entity || reached.has(key)) return;
    reached.add(key);
    for (const inner of entitiesNamedBy(entity.fields)) visit(inner);
    used.push(entity);
  };
  for (const key of entitiesNamedBy(fields)) visit(key);
  const unused = [...byKey].flatMap(([key, entity]) =>
    entity.ownedBy?.kind === host.kind &&
    entity.ownedBy.address === host.address &&
    !reached.has(key)
      ? [entity]
      : []
  );
  return { used, unused };
}

/**
 * How each kind a host's save creates first is created, and its definition
 * then written where that kind's own first save writes it. The write is
 * best-effort, as for any create: the entity stands once its create has
 * answered.
 */
export interface FieldGroupsFirstSteps {
  "field-group": {
    create: (payload: CreateComponentPayload) => Promise<unknown>;
    mirror: (entity: UnsavedEntity) => Promise<void>;
  };
  collection: {
    create: (payload: CreateCollectionPayload) => Promise<unknown>;
    mirror: (entity: UnsavedEntity) => Promise<void>;
  };
}

/** Creates `entity` with its own kind's create, as its own editor would. */
function createOne(
  entity: UnsavedEntity,
  steps: FieldGroupsFirstSteps
): Promise<unknown> {
  const { address, settings, fields } = entity;
  if (entity.kind === "collection") {
    return steps.collection.create(
      collectionCreatePayload(address, settings, fields)
    );
  }
  if (entity.kind === "field-group") {
    return steps["field-group"].create(
      fieldGroupCreatePayload(address, settings, fields)
    );
  }
  // No field names a Single, so none is created first; refused rather than
  // created by another kind's create, should one ever be asked for.
  return Promise.reject(
    new Error("A Single is not created before another entity.")
  );
}

/**
 * Creates each of `entities` in turn: its address checked once more (another
 * tab may have saved one under it), then created with what the dialog set by
 * its kind's create, its definition written where that kind's own first save
 * writes it (`mirror`), and let go from the unsaved ones. Stops at the first
 * refusal, which it returns in words naming the entity and its kind, so the
 * host is not saved and every entity not yet created stays unsaved; null when
 * all were created.
 */
export async function createFieldGroupsFirst(
  entities: readonly UnsavedEntity[],
  steps: FieldGroupsFirstSteps
): Promise<string | null> {
  for (const entity of entities) {
    const refusedAs = (reason: string) =>
      `The ${BUILDER_KIND_NOUN[entity.kind]} “${entity.settings.singularName}” was not created: ${reason}`;
    const refused = await checkAddressAgain(entity.kind, entity.address);
    if (refused !== null) return refusedAs(refused);
    try {
      await createOne(entity, steps);
    } catch (err) {
      return refusedAs(apiErrorMessage(err, "The server refused it."));
    }
    // Only the two kinds a field names are ever created first.
    if (entity.kind === "collection" || entity.kind === "field-group") {
      await steps[entity.kind].mirror(entity);
    }
    removeUnsavedEntity(entity.kind, entity.address);
  }
  return null;
}
