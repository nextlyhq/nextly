/**
 * Field write rules on the field-group instances a write stores inline.
 *
 * An instance directly on a document is stored in its field group's own table
 * and judged by the save that writes it there. One inside a group, a repeater
 * row or another instance has no table: it is stored inline, in its
 * container's column, so no field-group save reaches it, and this judges it
 * instead, through the same walk the read passes use.
 *
 * @module domains/field-groups/field-group-write-access
 */

import { isFieldGroupField } from "../../collections/fields/guards";
import type { FieldConfig } from "../../collections/fields/types";
import { keepDeniedAtStored } from "../../shared/lib/denied-change";
import { detachData } from "../../shared/lib/detach";
import {
  anyFieldGroupHasAccessRule,
  applyFieldWriteAccess,
  callerAccessGrants,
} from "../../shared/lib/field-level-registry";
import { standInForPasswordFieldValues } from "../../shared/lib/password-fields";
import { resolveComponentFieldMap } from "../versions/tag-component-types";

import {
  forEachFieldGroupInstance,
  type FieldGroupInstanceVisit,
  nameOf,
  rowsOf,
  subFieldsOf,
  type FieldGroupFieldsBySlug,
} from "./field-group-instances";
import {
  lookupOncePerFieldGroup,
  type FieldGroupFieldsSource,
} from "./live-read-access";
import type { FieldGroupWriteAccess } from "./services/field-group-mutation-service";
import { extractFieldGroupReferences } from "./storage/field-group-field-type";
import { readFieldGroupType } from "./storage/field-group-type-key";

/**
 * An update's field rules, applied in place, with every value they deny
 * inside a container kept as the row holds it: the entity's own (`ownRules`)
 * and those of the field groups it stores inline.
 *
 * A group or repeater is written whole, so a denied child removed from the
 * update would otherwise be cleared from the row: `keepDeniedAtStored` puts
 * the stored value back, the one answer a promotion gives the same question.
 * `stored` is the row in the update's representation.
 */
export async function keepDeniedAtStoredOnUpdate(params: {
  data: Record<string, unknown>;
  stored: Record<string, unknown>;
  fields: readonly FieldConfig[];
  source: FieldGroupFieldsSource | undefined;
  access: FieldGroupWriteAccess;
  executor?: unknown;
  /**
   * The entity's own field rules on the document it is given, in place: run
   * first, so a group of the entity's that a rule removes whole is not walked
   * for the field groups inside it.
   */
  ownRules: (document: Record<string, unknown>) => Promise<void>;
  /**
   * The stored instances in each of the entity's languages, so a removal is
   * judged in every language it removes; `stored` is the write's own.
   */
  storedIn?: StoredFieldGroupsInLanguages;
}): Promise<void> {
  if (params.access.overrideAccess) return;
  if (anyFieldGroupHasAccessRule("update")) {
    await keepProtectedStoredInstances({
      data: params.data,
      stored: params.stored,
      fields: params.fields,
      fieldGroupFields: await resolveFieldGroupFields(
        params.fields,
        params.source,
        params.executor
      ),
      access: withGrants(params.access, params.executor),
      translations: params.storedIn
        ? translationsOf(params.storedIn, params.fields)
        : undefined,
    });
  }
  const kept = await keepDeniedAtStored({
    update: params.data,
    stored: params.stored,
    applyRules: async document => {
      await params.ownRules(document);
      await applyInlineFieldGroupWriteAccess({
        data: document,
        fields: params.fields,
        source: params.source,
        operation: "update",
        access: params.access,
        executor: params.executor,
        stored: params.stored,
      });
    },
  });
  // In place: the caller holds this object, and so may what it was handed to.
  for (const key of Object.keys(params.data)) delete params.data[key];
  Object.assign(params.data, kept);
}

/**
 * Remove, in place, every field of an inline field-group instance in `data`
 * that the writer may not set, by that field group's own rules.
 *
 * `operation` is the document's: an inline instance has no row of its own to
 * exist or not, so it is created with the document and updated with it.
 * Nothing is looked up unless some field group declares a rule for it.
 */
export async function applyInlineFieldGroupWriteAccess(params: {
  data: Record<string, unknown>;
  fields: readonly FieldConfig[];
  source: FieldGroupFieldsSource | undefined;
  operation: "create" | "update";
  access: FieldGroupWriteAccess;
  /** The write's transaction-bound executor, when it holds a connection. */
  executor?: unknown;
  /**
   * An update's stored document, with the instances it holds in their own
   * tables. An instance there the update adds is created by it, and so is
   * what that instance holds inline, as its save judges it: without it, an
   * inline instance is judged by `operation` wherever it is held.
   */
  stored?: Record<string, unknown>;
}): Promise<void> {
  const { access, operation } = params;
  if (access.overrideAccess) return;
  if (!anyFieldGroupHasAccessRule(operation)) return;
  const fieldGroupFields = await resolveFieldGroupFields(
    params.fields,
    params.source,
    params.executor
  );
  await judgeFieldGroupInstances({
    data: params.data,
    fields: params.fields,
    fieldGroupFields,
    operation,
    access: withGrants(access, params.executor),
    // One stored in its own table is judged by the save that writes it there.
    inlineOnly: true,
    existing: params.stored
      ? await storedInstanceKeys(params.stored, params.fields, fieldGroupFields)
      : undefined,
  });
}

/**
 * The schemas of the field groups `fields` reach, looked up once each, on the
 * write's own connection; none without a source, which leaves only the
 * instances `fields` hold directly to judge.
 */
async function resolveFieldGroupFields(
  fields: readonly FieldConfig[],
  source: FieldGroupFieldsSource | undefined,
  executor: unknown
): Promise<FieldGroupFieldsBySlug> {
  if (!source) return new Map<string, FieldConfig[]>();
  return resolveComponentFieldMap(
    [...fields],
    lookupOncePerFieldGroup({
      getComponentFields: slug => source.getComponentFields(slug, executor),
    })
  );
}

/**
 * What reading an entity's stored field-group instances asks of the
 * field-group service: the one read that answers it, so this judgment and an
 * ordinary read describe the same stored document.
 */
export interface StoredFieldGroupSource {
  populateComponentData(params: {
    entry: Record<string, unknown>;
    parentTable: string;
    fields: FieldConfig[];
    depth?: number;
    strict?: boolean;
    executor?: unknown;
    locale?: string;
  }): Promise<Record<string, unknown>>;
}

/**
 * `stored` with the field-group instances the entity holds in their own
 * tables.
 *
 * The parent row does not carry them, so a stored document assembled from it
 * alone describes an entity with no field groups at all — and an update that
 * removes an instance would be judged against nothing. Read at `depth: 0`, as
 * every other write-path read of them is: an expanded relationship would put a
 * whole related row where an id belongs.
 *
 * Read only where a field group's update rules can judge an instance, so an
 * installation that declares none pays no query.
 */
export async function withStoredFieldGroups(params: {
  stored: Record<string, unknown>;
  parentTable: string;
  fields: readonly FieldConfig[];
  source: StoredFieldGroupSource | undefined;
  access: FieldGroupWriteAccess;
  executor?: unknown;
  /** The language to read them in: the write's own, or the default. */
  locale?: string;
}): Promise<Record<string, unknown>> {
  if (params.access.overrideAccess) return params.stored;
  if (!params.source) return params.stored;
  if (!anyFieldGroupHasAccessRule("update")) return params.stored;
  return params.source.populateComponentData({
    entry: { ...params.stored },
    parentTable: params.parentTable,
    fields: [...params.fields],
    depth: 0,
    strict: true,
    executor: params.executor,
    locale: params.locale,
  });
}

/** `access` with a grants resolver, read on the write's own connection. */
function withGrants(
  access: FieldGroupWriteAccess,
  executor: unknown
): FieldGroupWriteAccess {
  return {
    ...access,
    grants:
      access.grants ??
      callerAccessGrants(access.user, access.authenticatedScope, executor),
  };
}

/**
 * Remove, in place, every field of EVERY field-group instance in `document`
 * that the writer may not set, by that field group's own rules: the ones in
 * their own tables as well as the inline ones.
 *
 * For a promotion, which folds a pending change into the live row and judges
 * the whole document it is about to write before anything is saved, so a
 * denied value can be refused or kept at its live value rather than reaching
 * a save. The schemas are the ones the promotion already resolved; nothing is
 * looked up.
 */
export async function applyFieldGroupWriteAccessToDocument(params: {
  document: Record<string, unknown>;
  fields: readonly FieldConfig[];
  fieldGroupFields: FieldGroupFieldsBySlug;
  access: FieldGroupWriteAccess;
  /**
   * The live document. An instance in its own table that live does not hold
   * is new, and judged as the save will write it: as a create.
   */
  live: Record<string, unknown>;
}): Promise<void> {
  if (params.access.overrideAccess) return;
  if (
    !anyFieldGroupHasAccessRule("update") &&
    !anyFieldGroupHasAccessRule("create")
  ) {
    return;
  }
  await judgeFieldGroupInstances({
    data: params.document,
    fields: params.fields,
    fieldGroupFields: params.fieldGroupFields,
    operation: "update",
    access: params.access,
    inlineOnly: false,
    existing: await storedInstanceKeys(
      params.live,
      params.fields,
      params.fieldGroupFields
    ),
  });
}

/**
 * A held draft's field-group values, judged as its publish will judge them,
 * in place: each value the writer may not set is kept at what the draft
 * replaces (the previous draft, or the live document).
 *
 * A held save writes no instance, so no save judges what it holds; judged
 * only by a pass over a copy, the draft would keep a denied value for a later
 * publisher who may write it to promote. `names` are the field-group fields
 * the save touched; an instance the replaced document does not hold is new,
 * and judged as a create.
 */
export async function keepDeniedFieldGroupsInDraft(params: {
  draft: Record<string, unknown>;
  replaces: Record<string, unknown>;
  names: readonly string[];
  fields: readonly FieldConfig[];
  fieldGroupFields: FieldGroupFieldsBySlug;
  access: FieldGroupWriteAccess;
  /**
   * The stored instances in each of the entity's languages, so a removal is
   * judged in every language it removes, as an update's is: a held draft
   * writes no translation, so what an instance holds in another language is
   * what the live rows hold there.
   */
  storedIn?: StoredFieldGroupsInLanguages;
}): Promise<void> {
  if (params.access.overrideAccess) return;
  if (
    !anyFieldGroupHasAccessRule("update") &&
    !anyFieldGroupHasAccessRule("create")
  ) {
    return;
  }
  const pick = (document: Record<string, unknown>) =>
    Object.fromEntries(
      params.names
        .filter(name => Object.prototype.hasOwnProperty.call(document, name))
        .map(name => [name, document[name]])
    );
  const stored = pick(params.replaces);
  const existing = await storedInstanceKeys(
    stored,
    params.fields,
    params.fieldGroupFields
  );
  const update = pick(params.draft);
  // A draft that clears a field group, or drops a stored instance from a
  // list, removes it as an ordinary update would, and no save judges an
  // instance it is not sent: without this the removal is simply held, and a
  // later publisher allowed to write the protected child publishes it.
  if (anyFieldGroupHasAccessRule("update")) {
    await keepProtectedStoredInstances({
      data: update,
      stored,
      fields: params.fields,
      fieldGroupFields: params.fieldGroupFields,
      access: params.access,
      translations: params.storedIn
        ? translationsOf(params.storedIn, params.fields)
        : undefined,
    });
  }
  const kept = await keepDeniedAtStored({
    update,
    stored,
    applyRules: document =>
      judgeFieldGroupInstances({
        data: document,
        fields: params.fields,
        fieldGroupFields: params.fieldGroupFields,
        operation: "update",
        access: params.access,
        inlineOnly: false,
        existing,
      }),
  });
  for (const [name, value] of Object.entries(kept)) params.draft[name] = value;
}

/**
 * A stored instance's identity: the field holding it, its field group, and
 * its id there. The save looks an instance up among its own field's rows, so
 * an id from another field holding the same field group names no row here.
 */
function instanceKey(field: string, slug: string, id: string): string {
  return `${field}\u0000${slug}\u0000${id}`;
}

/**
 * The key a single field group's field has its stored instance under,
 * whatever id an instance is sent with: the save updates the row that field's
 * instance is, so any instance sent for it is that row. A dynamic zone's
 * blocks, even a single one, are matched by id.
 */
function singleInstanceKey(field: string, slug: string): string {
  return instanceKey(field, slug, "");
}

/**
 * The instances `document` holds in their own tables, each by its identity,
 * to the id it is stored under; a single field group's has it under
 * {@link singleInstanceKey} as well.
 */
async function storedInstanceKeys(
  document: Record<string, unknown>,
  fields: readonly FieldConfig[],
  fieldGroupFields: FieldGroupFieldsBySlug
): Promise<Map<string, string>> {
  const holdsOne = new Set(
    directFieldGroupFields(fields)
      .filter(
        field =>
          (field as { repeatable?: unknown }).repeatable !== true &&
          extractFieldGroupReferences(field).many === undefined
      )
      .map(nameOf)
  );
  const keys = new Map<string, string>();
  await forEachFieldGroupInstance(
    detachData(document),
    fields,
    fieldGroupFields,
    ({ instance, slug, field, inline }) => {
      if (!inline && typeof instance.id === "string") {
        keys.set(instanceKey(field, slug, instance.id), instance.id);
        if (holdsOne.has(field)) {
          keys.set(singleInstanceKey(field, slug), instance.id);
        }
      }
      return Promise.resolve();
    },
    { declaredComponentDecides: true }
  );
  return keys;
}

/**
 * Put back, in place, each stored instance an update removes (by clearing its
 * field or leaving it out of the list) that holds a value the writer may not
 * change: removing it would change that value, and its save never judges an
 * instance it is not sent. Put back with its id, it is updated in place, so
 * its denied values keep what they hold and its allowed ones are rewritten
 * as they are. A single field group's value is replaced in place by any value
 * sent, so only clearing it removes it.
 */
async function keepProtectedStoredInstances(params: {
  data: Record<string, unknown>;
  stored: Record<string, unknown>;
  fields: readonly FieldConfig[];
  fieldGroupFields: FieldGroupFieldsBySlug;
  access: FieldGroupWriteAccess;
  translations?: (id: string) => Promise<Record<string, unknown>[]>;
}): Promise<void> {
  for (const field of directFieldGroupFields(params.fields)) {
    const name = nameOf(field);
    if (name === undefined) continue;
    const sent = params.data[name];
    const storedRows = rowsOf(params.stored[name]);
    if (sent === undefined || storedRows.length === 0) continue;
    const { single, many } = extractFieldGroupReferences(field);
    const slugOf = (row: Record<string, unknown>) =>
      many !== undefined ? readFieldGroupType(row) : single;
    // A field that is not repeatable holds one instance, as an object: a
    // dynamic zone too, whose block is judged by the type it is stored as.
    const holdsOne = (field as { repeatable?: unknown }).repeatable !== true;
    const kept = holdsOne
      ? await keptSingleInstance(
          sent,
          { row: storedRows[0], slugOf, zone: many !== undefined },
          params
        )
      : await keptInstanceList(name, sent, storedRows, slugOf, params);
    if (kept !== undefined) params.data[name] = kept;
  }
}

/**
 * The value a field holding ONE instance keeps: the stored instance where the
 * write would remove it and it holds a value the writer may not change, and
 * nothing otherwise. A single field group's instance is replaced in place by
 * any instance sent, so only a clear removes it; a single dynamic zone's
 * block is also removed by a block that is not it (another id or type),
 * which the save adds in its place.
 */
async function keptSingleInstance(
  sent: unknown,
  stored: {
    row: Record<string, unknown> | undefined;
    slugOf: (row: Record<string, unknown>) => string | undefined;
    zone: boolean;
  },
  params: ProtectedInstanceParams
): Promise<unknown> {
  const { row, slugOf, zone } = stored;
  const slug = row ? slugOf(row) : undefined;
  if (row === undefined || slug === undefined) return undefined;
  const removes = sent === null || (zone && !isStoredBlock(sent, row, slugOf));
  if (!removes) return undefined;
  return (await holdsProtectedValue(row, slug, params)) ? row : undefined;
}

/** Whether `sent` names the stored block `row`: its id, as its type. */
function isStoredBlock(
  sent: unknown,
  row: Record<string, unknown>,
  slugOf: (row: Record<string, unknown>) => string | undefined
): boolean {
  if (sent === undefined) return true;
  if (sent === null || typeof sent !== "object" || Array.isArray(sent)) {
    return false;
  }
  const block = sent as Record<string, unknown>;
  return block.id === row.id && slugOf(block) === slugOf(row);
}

/**
 * The list a repeatable field or a dynamic zone keeps: the sent list with
 * each stored instance it drops that holds a value the writer may not change
 * put back at its stored place, or nothing when it drops none of them.
 */
async function keptInstanceList(
  field: string,
  sent: unknown,
  storedRows: Record<string, unknown>[],
  slugOf: (row: Record<string, unknown>) => string | undefined,
  params: ProtectedInstanceParams
): Promise<unknown> {
  const kept = Array.isArray(sent) ? [...(sent as unknown[])] : [];
  const sentKeys = new Set(
    rowsOf(kept).flatMap(row => {
      const slug = slugOf(row);
      return typeof row.id === "string" && slug
        ? [instanceKey(field, slug, row.id)]
        : [];
    })
  );
  let changed = false;
  for (const [index, row] of storedRows.entries()) {
    const slug = slugOf(row);
    if (!slug || typeof row.id !== "string") continue;
    if (sentKeys.has(instanceKey(field, slug, row.id))) continue;
    if (!(await holdsProtectedValue(row, slug, params))) continue;
    kept.splice(Math.min(index, kept.length), 0, row);
    changed = true;
  }
  return changed ? kept : undefined;
}

/** What judging a stored instance needs: the schemas, and who writes. */
interface ProtectedInstanceParams {
  fieldGroupFields: FieldGroupFieldsBySlug;
  access: FieldGroupWriteAccess;
  /**
   * The same stored instance, by id, in each language it is stored in;
   * absent where there is one language, or no way to read another.
   */
  translations?: (id: string) => Promise<Record<string, unknown>[]>;
}

/**
 * Where an entity's stored field-group instances can be read in each of its
 * languages: the languages, and a read of the stored document in one.
 */
export interface StoredFieldGroupsInLanguages {
  locales: readonly string[];
  read: (locale: string) => Promise<Record<string, unknown>>;
}

/**
 * Each stored instance, by id, in every language `storedIn` names. Read on
 * first ask and once per language, so an update that removes no instance
 * reads nothing more.
 */
function translationsOf(
  storedIn: StoredFieldGroupsInLanguages,
  fields: readonly FieldConfig[]
): (id: string) => Promise<Record<string, unknown>[]> {
  let byId: Promise<Map<string, Record<string, unknown>[]>> | undefined;
  const index = async () => {
    const found = new Map<string, Record<string, unknown>[]>();
    for (const locale of storedIn.locales) {
      const view = await storedIn.read(locale);
      for (const field of directFieldGroupFields(fields)) {
        const name = nameOf(field);
        if (name === undefined) continue;
        for (const row of rowsOf(view[name])) {
          if (typeof row.id !== "string") continue;
          found.set(row.id, [...(found.get(row.id) ?? []), row]);
        }
      }
    }
    return found;
  };
  return async id => {
    byId ??= index();
    return (await byId).get(id) ?? [];
  };
}

/**
 * Whether a stored instance holds a value the writer may not change, by its
 * field group's update rules and those of the field groups it holds inline.
 */
async function holdsProtectedValue(
  row: Record<string, unknown>,
  slug: string,
  params: ProtectedInstanceParams
): Promise<boolean> {
  if (await holdsProtectedValueHere(row, slug, params)) return true;
  // Removing an instance removes it in every language, so a value it holds
  // only in another language counts as one it holds.
  if (!params.translations || typeof row.id !== "string") return false;
  for (const translated of await params.translations(row.id)) {
    if (await holdsProtectedValueHere(translated, slug, params)) return true;
  }
  return false;
}

/**
 * What a stored password is judged as holding while its hash is not read:
 * any value, since a rule asked whether it may change one is not told which.
 */
const STORED_PASSWORD = "stored-password";

/** {@link holdsProtectedValue} for one language's view of the instance. */
async function holdsProtectedValueHere(
  row: Record<string, unknown>,
  slug: string,
  params: ProtectedInstanceParams
): Promise<boolean> {
  // Only what it holds: an empty field has no value to change. A copy all
  // the way down, since the stand-ins below go into its containers, and the
  // row itself may be kept and written back.
  const held = detachData(
    Object.fromEntries(
      Object.entries(row).filter(
        ([, value]) => value !== null && value !== undefined
      )
    )
  );
  // A stored instance is read without its password hashes, so each password
  // field is judged as holding one: removing the instance would delete it.
  const inner = params.fieldGroupFields.get(slug);
  if (inner) {
    standInForPasswordFieldValues(held, inner, STORED_PASSWORD);
  }
  const probe = detachData(held);
  const { access } = params;
  await applyFieldWriteAccess({
    kind: "fieldGroup",
    slug,
    data: probe,
    operation: "update",
    user: access.user,
    authenticatedScope: access.authenticatedScope,
    overrideAccess: false,
    id: typeof row.id === "string" ? row.id : undefined,
    grants: access.grants,
  });
  if (inner) {
    await judgeFieldGroupInstances({
      data: probe,
      fields: inner,
      fieldGroupFields: params.fieldGroupFields,
      operation: "update",
      access,
      inlineOnly: false,
    });
  }
  return JSON.stringify(probe) !== JSON.stringify(held);
}

/** The field-group fields directly on a document, through its layout containers. */
function directFieldGroupFields(fields: readonly FieldConfig[]): FieldConfig[] {
  const found: FieldConfig[] = [];
  const seen = new WeakSet<object>();
  const pending = [...fields];
  while (pending.length > 0) {
    const field = pending.pop()!;
    if (seen.has(field)) continue;
    seen.add(field);
    if (nameOf(field) === undefined)
      pending.push(...(subFieldsOf(field) ?? []));
    else if (isFieldGroupField(field)) found.push(field);
  }
  return found;
}

/**
 * Whether an instance the walk reaches is new, and the stored id it is
 * judged with: one in its own table is new where `existing` does not hold
 * it, by its id or as its field's one instance, as the save tells; one held
 * inline is created with the instance it is held in. `created` collects the
 * new instances in their own tables, which the walk reaches before what they
 * hold.
 */
function standingOf(
  reached: FieldGroupInstanceVisit,
  existing: ReadonlyMap<string, string> | undefined,
  created: WeakSet<object>
): { isNew: boolean; storedId: string | undefined } {
  const { instance, slug, field, inline, outer } = reached;
  if (inline) {
    return {
      isNew: outer !== undefined && created.has(outer),
      storedId: undefined,
    };
  }
  const id = typeof instance.id === "string" ? instance.id : undefined;
  const storedId =
    (id === undefined
      ? undefined
      : existing?.get(instanceKey(field, slug, id))) ??
    existing?.get(singleInstanceKey(field, slug));
  const isNew = existing !== undefined && storedId === undefined;
  if (isNew) created.add(instance);
  return { isNew, storedId };
}

/** The one judgment both passes make, over the instances the walk reaches. */
async function judgeFieldGroupInstances(params: {
  data: Record<string, unknown>;
  fields: readonly FieldConfig[];
  fieldGroupFields: FieldGroupFieldsBySlug;
  operation: "create" | "update";
  access: FieldGroupWriteAccess;
  inlineOnly: boolean;
  /**
   * The instances already stored in their own tables
   * (`storedInstanceKeys`). Given, one in its own table that is not among
   * them is new, and judged as a create; an inline one has no row of its own,
   * and is created with the instance it is held in when that one is new, and
   * otherwise takes `operation`, the document's.
   */
  existing?: ReadonlyMap<string, string>;
}): Promise<void> {
  const { access, existing } = params;
  const created = new WeakSet<object>();
  await forEachFieldGroupInstance(
    params.data,
    params.fields,
    params.fieldGroupFields,
    async reached => {
      const { instance, slug, inline } = reached;
      const { isNew, storedId } = standingOf(reached, existing, created);
      if (params.inlineOnly && !inline) return;
      await applyFieldWriteAccess({
        kind: "fieldGroup",
        slug,
        data: instance,
        operation: isNew ? "create" : params.operation,
        user: access.user,
        authenticatedScope: access.authenticatedScope,
        overrideAccess: false,
        // The stored instance's id, so an id-dependent rule is told what the
        // save will tell it. Only one verified against the live document is
        // named: a new instance is stored under an id of its own, so the one
        // it was sent with is the client's, and an inline instance has no row
        // of its own to name.
        id: storedId,
        grants: access.grants,
      });
    },
    // A write's value is live, so a single field group's instance is judged by
    // the field group its field declares, whatever type it claims.
    { declaredComponentDecides: true }
  );
}
