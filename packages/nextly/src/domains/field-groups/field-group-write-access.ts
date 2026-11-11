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
import {
  keepDeniedAtStored,
  storedProvenance,
} from "../../shared/lib/denied-change";
import { detachData } from "../../shared/lib/detach";
import {
  anyFieldGroupHasAccessRule,
  applyFieldWriteAccess,
  callerAccessGrants,
  getFieldFunctions,
  type FieldFunctions,
} from "../../shared/lib/field-level-registry";
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
}): Promise<{
  storedPaths: ReadonlySet<string>;
  storedValues: ReadonlyMap<string, unknown>;
}> {
  if (params.access.overrideAccess) {
    return { storedPaths: new Set(), storedValues: new Map() };
  }
  if (anyFieldGroupHasAccessRule("update")) {
    const fieldGroupFields = await resolveFieldGroupFields(
      params.fields,
      params.source,
      params.executor
    );
    await keepProtectedStoredInstances({
      data: params.data,
      stored: params.stored,
      fields: params.fields,
      fieldGroupFields,
      access: withGrants(params.access, params.executor),
      translations: params.storedIn
        ? translationsOf(params.storedIn, params.fields, fieldGroupFields)
        : undefined,
    });
  }
  const { kept, permitted } = await keepDeniedAtStored({
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
  // The paths that now hold the row's own value, for the whole-number rule
  // to leave to the row: the write is judged after this, and a legacy
  // stored fraction under a denied path is the row's own content, carried
  // by this restore, not a value this write produced. Told from what the
  // rules left of the caller's own update — no rule runs again, so a rule
  // reading a denied sibling answers as it answered for the restore.
  const { paths: storedPaths, values: storedValues } = storedProvenance(
    kept,
    permitted
  );
  // In place: the caller holds this object, and so may what it was handed to.
  for (const key of Object.keys(params.data)) delete params.data[key];
  Object.assign(params.data, kept);
  return { storedPaths, storedValues };
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
      callerAccessGrants(
        access.user,
        access.authenticatedScope,
        executor,
        access.visitor
      ),
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
        ? translationsOf(
            params.storedIn,
            params.fields,
            params.fieldGroupFields
          )
        : undefined,
    });
  }
  const { kept } = await keepDeniedAtStored({
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
 * A stored instance's identity: the identity of the stored instance holding it
 * ("" for one on the document), the field holding it, its field group, and its
 * id there. The save looks an instance up among the rows its own field holds
 * under its own parent row, so an id from another field, or from under another
 * instance, names no row here, and the instance is created.
 */
function instanceKey(
  parent: string,
  field: string,
  slug: string,
  id: string
): string {
  return JSON.stringify([parent, field, slug, id]);
}

/**
 * The key a single field group's field has its stored instance under,
 * whatever id an instance is sent with: the save updates the row that field's
 * instance is, so any instance sent for it is that row. A dynamic zone's
 * blocks, even a single one, are matched by id.
 */
function singleInstanceKey(
  parent: string,
  field: string,
  slug: string
): string {
  return instanceKey(parent, field, slug, "");
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
  const keys = new Map<string, string>();
  // Each stored instance's own identity, which the instances placed directly in
  // it name as their parent. The walk reaches an instance before what it holds.
  const identity = new WeakMap<object, string>();
  await forEachFieldGroupInstance(
    detachData(document),
    fields,
    fieldGroupFields,
    ({ instance, slug, field, single, inline, outer }) => {
      const parent = outer === undefined ? "" : identity.get(outer);
      if (!inline && typeof instance.id === "string" && parent !== undefined) {
        const key = instanceKey(parent, field, slug, instance.id);
        identity.set(instance, key);
        keys.set(key, instance.id);
        if (single)
          keys.set(singleInstanceKey(parent, field, slug), instance.id);
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
    await keepProtectedNestedInstances(
      params,
      keptPairs(params.data[name], storedRows, {
        holdsOne,
        zone: many !== undefined,
        slugOf,
      }),
      slugOf
    );
  }
}

/**
 * A stored instance the write keeps can still remove a field group placed directly in it, which
 * its save then deletes with every row below: each kept instance judged in turn, against its
 * stored self.
 */
async function keepProtectedNestedInstances(
  params: Parameters<typeof keepProtectedStoredInstances>[0],
  pairs: Array<[Record<string, unknown>, Record<string, unknown>]>,
  slugOf: (row: Record<string, unknown>) => string | undefined
): Promise<void> {
  for (const [sentRow, storedRow] of pairs) {
    const slug = slugOf(storedRow);
    const inner =
      slug === undefined ? undefined : params.fieldGroupFields.get(slug);
    if (!inner) continue;
    await keepProtectedStoredInstances({
      ...params,
      data: sentRow,
      stored: storedRow,
      fields: inner,
    });
  }
}

/**
 * Each instance a write sends paired with the stored instance it updates in place: in a list by
 * id; the one value of a field holding one, which a single field group updates whatever id it is
 * sent with, and a single zone only when it names the stored block.
 */
function keptPairs(
  value: unknown,
  storedRows: Record<string, unknown>[],
  shape: {
    holdsOne: boolean;
    zone: boolean;
    slugOf: (row: Record<string, unknown>) => string | undefined;
  }
): Array<[Record<string, unknown>, Record<string, unknown>]> {
  if (shape.holdsOne) {
    const [sent] = rowsOf(value);
    const row = storedRows[0];
    if (sent === undefined || row === undefined) return [];
    if (shape.zone && !isStoredBlock(sent, row, shape.slugOf)) return [];
    return [[sent, row]];
  }
  const byId = new Map(
    storedRows.flatMap(row =>
      typeof row.id === "string" ? [[row.id, row] as const] : []
    )
  );
  return rowsOf(value).flatMap(sent => {
    const row = typeof sent.id === "string" ? byId.get(sent.id) : undefined;
    return row === undefined
      ? []
      : [[sent, row] as [Record<string, unknown>, Record<string, unknown>]];
  });
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
        ? [instanceKey("", field, slug, row.id)]
        : [];
    })
  );
  let changed = false;
  for (const [index, row] of storedRows.entries()) {
    const slug = slugOf(row);
    if (!slug || typeof row.id !== "string") continue;
    if (sentKeys.has(instanceKey("", field, slug, row.id))) continue;
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
  fields: readonly FieldConfig[],
  fieldGroupFields: FieldGroupFieldsBySlug
): (id: string) => Promise<Record<string, unknown>[]> {
  let byId: Promise<Map<string, Record<string, unknown>[]>> | undefined;
  const index = async () => {
    const found = new Map<string, Record<string, unknown>[]>();
    for (const locale of storedIn.locales) {
      indexStoredInstances(
        await storedIn.read(locale),
        fields,
        fieldGroupFields,
        found
      );
    }
    return found;
  };
  return async id => {
    byId ??= index();
    return (await byId).get(id) ?? [];
  };
}

/**
 * Each stored instance `level` holds in its field-group fields, by id, and each one placed directly
 * in those, at any depth: a row read back holds what is below it, so the walk ends with the data.
 */
function indexStoredInstances(
  level: Record<string, unknown>,
  fields: readonly FieldConfig[],
  fieldGroupFields: FieldGroupFieldsBySlug,
  found: Map<string, Record<string, unknown>[]>
): void {
  for (const field of directFieldGroupFields(fields)) {
    const name = nameOf(field);
    if (name === undefined) continue;
    for (const row of rowsOf(level[name])) {
      indexStoredInstance(row, field, fieldGroupFields, found);
    }
  }
}

/** {@link indexStoredInstances} for one stored instance of `field`, and what is placed in it. */
function indexStoredInstance(
  row: Record<string, unknown>,
  field: FieldConfig,
  fieldGroupFields: FieldGroupFieldsBySlug,
  found: Map<string, Record<string, unknown>[]>
): void {
  if (typeof row.id !== "string") return;
  found.set(row.id, [...(found.get(row.id) ?? []), row]);
  const { single, many } = extractFieldGroupReferences(field);
  const slug = many !== undefined ? readFieldGroupType(row) : single;
  const inner = slug === undefined ? undefined : fieldGroupFields.get(slug);
  if (inner) indexStoredInstances(row, inner, fieldGroupFields, found);
}

/**
 * Whether a field group, or one placed directly in it at any depth, declares a password whose
 * update a rule judges: removing an instance removes what is placed directly in it too, and each
 * such password is read stripped, so the instance is protected instead. `seen` ends a definition
 * that places a field group inside itself.
 */
function fieldGroupJudgesAnUnreadPassword(
  slug: string,
  fieldGroupFields: FieldGroupFieldsBySlug,
  seen: Set<string> = new Set()
): boolean {
  if (seen.has(slug)) return false;
  seen.add(slug);
  const inner = fieldGroupFields.get(slug);
  if (!inner) return false;
  if (judgesAnUnreadPassword(inner, getFieldFunctions("fieldGroup", slug))) {
    return true;
  }
  return directFieldGroupFields(inner).some(field => {
    const { single, many } = extractFieldGroupReferences(field);
    return [...(single === undefined ? [] : [single]), ...(many ?? [])].some(
      next => fieldGroupJudgesAnUnreadPassword(next, fieldGroupFields, seen)
    );
  });
}

/**
 * Whether a stored instance holds a value the writer may not change, by its
 * field group's update rules and those of the field groups it holds, inline or
 * placed directly in it, which a removal takes with it.
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
 * Whether `fields` declare a password whose update a rule judges, at any
 * depth, by `fns`, the functions registered for those fields. A stored value
 * is read with its password hashes stripped, so such a rule could only be
 * asked about a value it was not given; the instance is protected instead.
 */
function judgesAnUnreadPassword(
  fields: readonly FieldConfig[],
  fns: Record<string, FieldFunctions> | undefined
): boolean {
  return fields.some(field => {
    const name = nameOf(field);
    const sub = subFieldsOf(field);
    // A layout container keeps its fields on the level it sits on.
    if (name === undefined) return judgesAnUnreadPassword(sub ?? [], fns);
    if ((field as { type?: unknown }).type === "password") {
      return fns?.[name]?.access?.update !== undefined;
    }
    return (
      sub !== undefined && judgesAnUnreadPassword(sub, fns?.[name]?.fields)
    );
  });
}

/** {@link holdsProtectedValue} for one language's view of the instance. */
async function holdsProtectedValueHere(
  row: Record<string, unknown>,
  slug: string,
  params: ProtectedInstanceParams
): Promise<boolean> {
  // Only what it holds: an empty field has no value to change. A copy all
  // the way down, since the rules below remove from its containers, and the
  // row itself may be kept and written back.
  const held = detachData(
    Object.fromEntries(
      Object.entries(row).filter(
        ([, value]) => value !== null && value !== undefined
      )
    )
  );
  const inner = params.fieldGroupFields.get(slug);
  if (fieldGroupJudgesAnUnreadPassword(slug, params.fieldGroupFields)) {
    return true;
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

/**
 * Whether `fields` hold a field-group field at any depth: directly, or in a
 * group, repeater or layout container. A field group's rules can judge only a
 * document that holds one.
 */
export function reachesFieldGroup(fields: readonly FieldConfig[]): boolean {
  let found = false;
  walkFieldsOnce(fields, field => {
    if (found || isFieldGroupField(field)) {
      found = true;
      return undefined;
    }
    return subFieldsOf(field);
  });
  return found;
}

/**
 * The field-group fields directly on a document, through its layout containers. A field group's
 * own fields are such a document too, so every walk over the field groups stored as rows beneath
 * an instance (its write, read and delete) asks this as well.
 */
export function directFieldGroupFields(
  fields: readonly FieldConfig[]
): FieldConfig[] {
  const found: FieldConfig[] = [];
  walkFieldsOnce(fields, field => {
    if (nameOf(field) === undefined) return subFieldsOf(field);
    if (isFieldGroupField(field)) found.push(field);
    return undefined;
  });
  return found;
}

/**
 * Visit each field `fields` reach once, through the fields `visit` returns
 * for each: a field reached twice, as a container shared by two places or
 * one that reaches itself, is visited the first time only.
 */
function walkFieldsOnce(
  fields: readonly FieldConfig[],
  visit: (field: FieldConfig) => readonly FieldConfig[] | undefined
): void {
  const seen = new WeakSet<object>();
  const pending = [...fields];
  while (pending.length > 0) {
    const field = pending.pop()!;
    if (seen.has(field)) continue;
    seen.add(field);
    pending.push(...(visit(field) ?? []));
  }
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
  seen: { created: WeakSet<object>; identity: WeakMap<object, string> }
): { isNew: boolean; storedId: string | undefined } {
  const { instance, inline, outer } = reached;
  if (inline) {
    return {
      isNew: outer !== undefined && seen.created.has(outer),
      storedId: undefined,
    };
  }
  // The stored row this instance's parent was matched to: none for a parent this
  // write creates, under which every instance is created too, whatever id it
  // carries.
  const parent = outer === undefined ? "" : seen.identity.get(outer);
  const match = matchedStored(existing, parent, reached);
  if (match) seen.identity.set(instance, match.key);
  const isNew = existing !== undefined && match === undefined;
  if (isNew) seen.created.add(instance);
  return { isNew, storedId: match?.id };
}

/**
 * The stored instance one in its own table is matched to under `parent`, by the id it carries or
 * as its field's one instance, with the identity the instances placed in it name as their parent;
 * none without stored instances, or under a parent that matched none.
 */
function matchedStored(
  existing: ReadonlyMap<string, string> | undefined,
  parent: string | undefined,
  at: Pick<FieldGroupInstanceVisit, "instance" | "field" | "slug">
): { id: string; key: string } | undefined {
  if (existing === undefined || parent === undefined) return undefined;
  const { instance, field, slug } = at;
  const byId =
    typeof instance.id === "string"
      ? existing.get(instanceKey(parent, field, slug, instance.id))
      : undefined;
  const id = byId ?? existing.get(singleInstanceKey(parent, field, slug));
  return id === undefined
    ? undefined
    : { id, key: instanceKey(parent, field, slug, id) };
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
  const seen = {
    created: new WeakSet<object>(),
    identity: new WeakMap<object, string>(),
  };
  await forEachFieldGroupInstance(
    params.data,
    params.fields,
    params.fieldGroupFields,
    async reached => {
      const { instance, slug, inline } = reached;
      const { isNew, storedId } = standingOf(reached, existing, seen);
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
