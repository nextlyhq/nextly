/**
 * A field group's fields are read-only inside the collections, Singles and field groups that use
 * it: they are changed only in the field group's own editor, which reaches every user at once. A
 * host's save carries a field group as a reference; one that also carries the field group's fields
 * (`fields`, or the `componentFields` and `componentSchemas` a read hands out) is refused, naming
 * the field group, where any copy differs from the field group's own, by a field added, removed,
 * edited or reordered. A copy that matches is the read's own echo and changes nothing.
 *
 * Asked on every road a request saves a host's fields by: the Schema Builder's creates, updates,
 * previews and applies, and the schema REST routes. Server code (a service, a plugin's services,
 * the Direct API) is trusted as the access gate trusts it, and is not asked.
 *
 * @module domains/field-groups/field-group-fields-read-only
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../../errors";
import { deepEqual } from "../../shared/lib/deep-equal";

import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "./storage/field-group-field-type";

/**
 * Where a check reads the field groups' fields as stored: past the registry row cache, so a copy
 * is compared with the field group as it stands, not as an earlier read cached it, and all of them
 * in one read, so a save's hold on the schema exclusion does not grow with the field groups it uses.
 */
export interface StoredFieldGroups {
  getAllFieldLists(): Promise<readonly { slug: string; fields?: unknown }[]>;
}

/** The field groups a request's save compares its copies with, while its service call runs. */
const judging = new AsyncLocalStorage<StoredFieldGroups>();

/**
 * Runs a request's save of a host's fields: a service it reaches, where it is to write them,
 * compares the copies in the save with `fieldGroups` (`judgeFieldGroupCopies`), inside its own
 * schema exclusion, so a field group's edit can land neither before the comparison nor between it
 * and the write. Nothing is compared where there is no registry to compare with.
 */
export function withFieldGroupCopiesJudged<T>(
  fieldGroups: StoredFieldGroups | undefined,
  save: () => Promise<T>
): Promise<T> {
  return fieldGroups === undefined ? save() : judging.run(fieldGroups, save);
}

/**
 * Refuses the fields a service is about to write, inside its schema exclusion, where they change
 * a field group's fields through a host (`refuseFieldGroupFieldsChangedInHost`), for a request's
 * save alone: a save of server code opens no scope (`withFieldGroupCopiesJudged`) and is not asked.
 */
export async function judgeFieldGroupCopies(fields: unknown): Promise<void> {
  await refuseFieldGroupFieldsChangedInHost(fields, judging.getStore());
}

/** What a read adds to a field-group field beside its reference, which is not its definition. */
const DERIVED = ["componentFields", "componentSchemas"] as const;

/**
 * `fields` with what a read adds to each field-group field taken away, at any depth: from a
 * field-group field alone, since another type's `componentFields` or `componentSchemas` is an
 * option of its own (a plugin field's), which a change must be seen in.
 */
function withoutDerived(fields: unknown): unknown {
  if (!Array.isArray(fields)) return fields;
  return fields.map(field => {
    if (field === null || typeof field !== "object") return field;
    const copy: Record<string, unknown> = { ...field };
    if (isFieldGroupFieldType(copy.type)) {
      for (const key of DERIVED) delete copy[key];
    }
    if (Array.isArray(copy.fields)) copy.fields = withoutDerived(copy.fields);
    return copy;
  });
}

/**
 * Every copy of a field group's fields one field-group field carries, each with the field group it
 * copies: a fixed reference's `fields` and `componentFields` both, and each of `componentSchemas`.
 * Each is kept, so a copy that matches never stands in for one beside it that does not.
 */
function copiesIn(
  field: Record<string, unknown>
): { slug: string; copy: unknown[] }[] {
  const { single } = extractFieldGroupReferences(field);
  const copies: { slug: string; copy: unknown[] }[] = [];
  if (single !== undefined) {
    for (const key of ["fields", "componentFields"] as const) {
      const list = field[key];
      if (Array.isArray(list)) copies.push({ slug: single, copy: list });
    }
  }
  const schemas = field.componentSchemas;
  if (schemas !== null && typeof schemas === "object") {
    for (const [slug, schema] of Object.entries(schemas)) {
      const list = (schema as { fields?: unknown } | null)?.fields;
      if (Array.isArray(list)) copies.push({ slug, copy: list });
    }
  }
  return copies;
}

/**
 * Refuses a host's save that changes the fields of a field group it uses, before anything is
 * written. Each field-group field the save carries, in a group or repeater too, is compared, by
 * every copy of a field group's fields it carries, with that field group's stored fields; and the
 * field groups each copy places are compared with their own in turn, since a read's additions are
 * left out of the comparison that holds them. A field group `fieldGroups` does not hold is left to
 * the save's own checks.
 */
export async function refuseFieldGroupFieldsChangedInHost(
  fields: unknown,
  fieldGroups: StoredFieldGroups | undefined
): Promise<void> {
  if (fieldGroups === undefined) return;
  const storedFieldsOf = storedFieldsReader(fieldGroups);
  const pending: unknown[] = Array.isArray(fields) ? [...fields] : [];
  for (let field = pending.pop(); field !== undefined; field = pending.pop()) {
    pending.push(...(await fieldsWithin(field, storedFieldsOf)));
  }
}

/**
 * Each field group's stored fields by its slug, or `undefined` for one `fieldGroups` does not hold:
 * read together, once, when the first copy asks, and not at all for a save that copies none.
 */
function storedFieldsReader(
  fieldGroups: StoredFieldGroups
): (slug: string) => Promise<unknown> {
  let lists: Promise<Map<string, unknown>> | undefined;
  return async slug => {
    lists ??= fieldGroups
      .getAllFieldLists()
      .then(all => new Map(all.map(each => [each.slug, each.fields ?? []])));
    return (await lists).get(slug);
  };
}

/**
 * The fields to look through below `field`: a group's or repeater's own, or a field-group field's
 * copies of its field groups' fields, once each is compared with what its field group stores.
 */
async function fieldsWithin(
  field: unknown,
  storedFieldsOf: (slug: string) => Promise<unknown>
): Promise<unknown[]> {
  if (field === null || typeof field !== "object") return [];
  const record = field as Record<string, unknown>;
  if (!isFieldGroupFieldType(record.type)) {
    return Array.isArray(record.fields) ? record.fields : [];
  }
  const within: unknown[] = [];
  for (const { slug, copy } of copiesIn(record)) {
    const stored = await storedFieldsOf(slug);
    if (stored !== undefined) refuseChangedCopy(record, slug, copy, stored);
    within.push(...copy);
  }
  return within;
}

/** Refuses one copy of a field group's fields that differs from what it stores, naming it. */
function refuseChangedCopy(
  record: Record<string, unknown>,
  slug: string,
  copy: unknown[],
  stored: unknown
): void {
  if (deepEqual(withoutDerived(copy), withoutDerived(stored))) return;
  const name = typeof record.name === "string" ? record.name : slug;
  const message = `${name} holds the field group ${slug}, whose fields are changed only in its own editor: a change there reaches every collection, Single and field group using it. Change ${slug} in its own editor.`;
  throw NextlyError.validation({
    errors: [{ path: name, code: "FIELD_GROUP_READ_ONLY", message }],
    logContext: { fieldGroup: slug, field: name },
  });
}
