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
import { resolveComponentFieldMap } from "../versions/tag-component-types";

import {
  forEachFieldGroupInstance,
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
}): Promise<void> {
  const { access, operation } = params;
  if (access.overrideAccess) return;
  if (!anyFieldGroupHasAccessRule(operation)) return;
  await judgeFieldGroupInstances({
    data: params.data,
    fields: params.fields,
    fieldGroupFields: await resolveFieldGroupFields(
      params.fields,
      params.source,
      params.executor
    ),
    operation,
    access: withGrants(access, params.executor),
    // One stored in its own table is judged by the save that writes it there.
    inlineOnly: true,
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

/** A stored instance's identity: its field group, and its id there. */
function instanceKey(slug: string, id: string): string {
  return `${slug}\u0000${id}`;
}

/** The identities of the instances `document` holds in their own tables. */
async function storedInstanceKeys(
  document: Record<string, unknown>,
  fields: readonly FieldConfig[],
  fieldGroupFields: FieldGroupFieldsBySlug
): Promise<Set<string>> {
  const keys = new Set<string>();
  await forEachFieldGroupInstance(
    detachData(document),
    fields,
    fieldGroupFields,
    ({ instance, slug, inline }) => {
      if (!inline && typeof instance.id === "string") {
        keys.add(instanceKey(slug, instance.id));
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
    const holdsOne =
      many === undefined &&
      (field as { repeatable?: unknown }).repeatable !== true;
    const kept = holdsOne
      ? await keptSingleInstance(sent, storedRows[0], single, params)
      : await keptInstanceList(sent, storedRows, slugOf, params);
    if (kept !== undefined) params.data[name] = kept;
  }
}

/**
 * The value a field holding ONE instance keeps: the stored instance where a
 * clear would remove a value the writer may not change, and nothing
 * otherwise. Any instance sent replaces the stored one in place, so only a
 * clear can remove it.
 */
async function keptSingleInstance(
  sent: unknown,
  storedRow: Record<string, unknown> | undefined,
  slug: string | undefined,
  params: ProtectedInstanceParams
): Promise<unknown> {
  if (sent !== null || storedRow === undefined || slug === undefined) {
    return undefined;
  }
  return (await holdsProtectedValue(storedRow, slug, params))
    ? storedRow
    : undefined;
}

/**
 * The list a repeatable field or a dynamic zone keeps: the sent list with
 * each stored instance it drops that holds a value the writer may not change
 * put back at its stored place, or nothing when it drops none of them.
 */
async function keptInstanceList(
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
        ? [instanceKey(slug, row.id)]
        : [];
    })
  );
  let changed = false;
  for (const [index, row] of storedRows.entries()) {
    const slug = slugOf(row);
    if (!slug || typeof row.id !== "string") continue;
    if (sentKeys.has(instanceKey(slug, row.id))) continue;
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

/** {@link holdsProtectedValue} for one language's view of the instance. */
async function holdsProtectedValueHere(
  row: Record<string, unknown>,
  slug: string,
  params: ProtectedInstanceParams
): Promise<boolean> {
  // Only what it holds: an empty field has no value to change.
  const held = Object.fromEntries(
    Object.entries(row).filter(
      ([, value]) => value !== null && value !== undefined
    )
  );
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
  const inner = params.fieldGroupFields.get(slug);
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

/** The one judgment both passes make, over the instances the walk reaches. */
async function judgeFieldGroupInstances(params: {
  data: Record<string, unknown>;
  fields: readonly FieldConfig[];
  fieldGroupFields: FieldGroupFieldsBySlug;
  operation: "create" | "update";
  access: FieldGroupWriteAccess;
  inlineOnly: boolean;
  /**
   * The identities of the instances already stored in their own tables
   * (`storedInstanceKeys`). Given, one in its own table that is not among
   * them is new, and judged as a create; an inline one has no row of its own
   * and takes `operation`, the document's.
   */
  existing?: ReadonlySet<string>;
}): Promise<void> {
  const { access, existing } = params;
  await forEachFieldGroupInstance(
    params.data,
    params.fields,
    params.fieldGroupFields,
    async ({ instance, slug, inline }) => {
      if (params.inlineOnly && !inline) return;
      const storedHere =
        !inline &&
        typeof instance.id === "string" &&
        existing?.has(instanceKey(slug, instance.id)) === true;
      const isNew = existing !== undefined && !inline && !storedHere;
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
        id: storedHere ? (instance.id as string) : undefined,
        grants: access.grants,
      });
    },
    // A write's value is live, so a single field group's instance is judged by
    // the field group its field declares, whatever type it claims.
    { declaredComponentDecides: true }
  );
}
