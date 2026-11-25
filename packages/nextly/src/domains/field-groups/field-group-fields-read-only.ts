/**
 * A field group's fields are read-only inside the collections, Singles and field groups that use
 * it: they are changed only in the field group's own editor, which reaches every user at once. A
 * host's save carries a field group as a reference; one that also carries the field group's fields
 * (`fields`, or the `componentFields` and `componentSchemas` a read hands out) is refused, naming
 * the field group, where any copy differs from the field group's own, by a field added, removed,
 * edited or reordered. A copy that matches is the read's own echo and changes nothing, and neither
 * does one the host already holds: the field group may have changed since that copy was stored,
 * and a save that sends the host back as it is, changing something else, edits no field group.
 *
 * Asked on every road a request saves a host's fields by: the Schema Builder's creates, updates,
 * previews and applies, and the schema REST routes. Server code (a service, a plugin's services,
 * the Direct API) is trusted as the access gate trusts it, and is not asked.
 *
 * @module domains/field-groups/field-group-fields-read-only
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../../errors";
import { isBuiltInFieldType } from "../../schemas/_zod/ui-schema";
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

/**
 * Reads the fields the host holds before a save, where the save changes a host there is. Asked only
 * for a copy that differs from its field group, so a save that carries none reads nothing.
 */
export type HeldHostFields = () => unknown;

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
export async function judgeFieldGroupCopies(
  fields: unknown,
  held?: HeldHostFields
): Promise<void> {
  await refuseFieldGroupFieldsChangedInHost(fields, judging.getStore(), held);
}

/** What a read adds to a field-group field beside its reference, which is not its definition. */
const DERIVED = ["componentFields", "componentSchemas"] as const;

/** The settings a field without them has turned off, which the Schema Builder writes as `false`. */
const OFF_UNLESS_SET = ["required", "unique", "index"] as const;

/**
 * `fields` as two spellings of one definition compare, at any depth. Without what a read adds to
 * each field-group field: to a field-group field alone, since another type's `componentFields` or
 * `componentSchemas` is an option of its own (a plugin field's), which a change must be seen in. And
 * without what the Schema Builder writes on every field it sends back though the definition leaves
 * it out: a setting that is off, a label that is the name, an option's id. From a built-in type
 * alone: a type a plugin contributes may mean something of its own by any of them, so a field of one
 * is compared as it is, and the fields inside it by their own types.
 */
function asCompared(fields: unknown): unknown {
  return Array.isArray(fields) ? fields.map(fieldAsCompared) : fields;
}

/** One field of `asCompared`. */
function fieldAsCompared(field: unknown): unknown {
  if (field === null || typeof field !== "object") return field;
  const copy: Record<string, unknown> = { ...field };
  const fieldGroup = isFieldGroupFieldType(copy.type);
  if (fieldGroup) for (const key of DERIVED) delete copy[key];
  if (fieldGroup || isBuiltInFieldType(String(copy.type))) {
    for (const key of saysNothing(copy)) delete copy[key];
    if (Array.isArray(copy.options)) copy.options = withoutIds(copy.options);
  }
  if (Array.isArray(copy.fields)) copy.fields = asCompared(copy.fields);
  return copy;
}

/** The keys of a built-in field that add nothing to its definition (`asCompared`). */
function saysNothing(field: Record<string, unknown>): string[] {
  return [
    ...OFF_UNLESS_SET.filter(key => field[key] === false),
    ...(field.label === field.name ? ["label"] : []),
  ];
}

/** A field's options without the ids the Schema Builder gives them. */
function withoutIds(options: readonly unknown[]): unknown[] {
  return options.map(option => {
    if (option === null || typeof option !== "object") return option;
    const { id: _id, ...rest } = option as Record<string, unknown>;
    return rest;
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
 * every copy of a field group's fields it carries, with that field group's stored fields, and, where
 * it differs, with the copies of that field group's fields the host holds (`held`). Each of those
 * stands for one copy in the save, so a field the host holds a copy in may be renamed or moved with
 * it, and no other field takes the same copy beside it. The field groups each copy places are
 * compared with their own in turn, since a read's additions are left out of the comparison that
 * holds them. A field group `fieldGroups` does not hold is left to the save's own checks.
 */
export async function refuseFieldGroupFieldsChangedInHost(
  fields: unknown,
  fieldGroups: StoredFieldGroups | undefined,
  held?: HeldHostFields
): Promise<void> {
  if (fieldGroups === undefined) return;
  const compared: Compared = {
    storedFieldsOf: storedFieldsReader(fieldGroups),
    takeHeld: heldCopiesTaker(held),
  };
  const pending: unknown[] = Array.isArray(fields) ? [...fields] : [];
  for (let field = pending.pop(); field !== undefined; field = pending.pop()) {
    pending.push(...(await fieldsWithin(field, compared)));
  }
}

/** What a save's copies of a field group's fields are compared with, by the field group's slug. */
interface Compared {
  storedFieldsOf: (slug: string) => Promise<unknown>;
  /** Whether the host holds `copy`, taking the one that stands for it. */
  takeHeld: (slug: string, copy: unknown[]) => Promise<boolean>;
}

/**
 * Takes a copy of a field group's fields the host holds, each once. The host's fields are read once,
 * when the first copy is asked for.
 */
function heldCopiesTaker(
  held: HeldHostFields | undefined
): Compared["takeHeld"] {
  let copies: Promise<Map<string, unknown[][]>> | undefined;
  return async (slug, copy) => {
    copies ??= (async () => copiesHeldIn(await held?.()))();
    const left = (await copies).get(slug) ?? [];
    const at = left.findIndex(each => sameFields(copy, each));
    if (at === -1) return false;
    left.splice(at, 1);
    return true;
  };
}

/** Every copy of a field group's fields `fields` holds, at any depth, by the field group's slug. */
function copiesHeldIn(fields: unknown): Map<string, unknown[][]> {
  const held = new Map<string, unknown[][]>();
  const pending: unknown[] = Array.isArray(fields) ? [...fields] : [];
  for (let field = pending.pop(); field !== undefined; field = pending.pop()) {
    if (field === null || typeof field !== "object") continue;
    const record = field as Record<string, unknown>;
    if (!isFieldGroupFieldType(record.type)) {
      if (Array.isArray(record.fields)) pending.push(...record.fields);
      continue;
    }
    for (const { slug, copy } of copiesIn(record)) {
      held.set(slug, [...(held.get(slug) ?? []), copy]);
      pending.push(...copy);
    }
  }
  return held;
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
 * copies of its field groups' fields, once each is compared with what its field group stores and,
 * where it differs, with what the host holds.
 */
async function fieldsWithin(
  field: unknown,
  compared: Compared
): Promise<unknown[]> {
  if (field === null || typeof field !== "object") return [];
  const record = field as Record<string, unknown>;
  if (!isFieldGroupFieldType(record.type)) {
    return Array.isArray(record.fields) ? record.fields : [];
  }
  const within: unknown[] = [];
  for (const { slug, copy } of copiesIn(record)) {
    const stored = await compared.storedFieldsOf(slug);
    if (
      stored !== undefined &&
      !sameFields(copy, stored) &&
      !(await compared.takeHeld(slug, copy))
    ) {
      refuseCopy(record, slug);
    }
    within.push(...copy);
  }
  return within;
}

/** Whether two lists of fields are one definition, however each spells it (`asCompared`). */
function sameFields(a: unknown, b: unknown): boolean {
  return deepEqual(asCompared(a), asCompared(b));
}

/** Refuses a field-group field whose copy of the field group's fields changes them, naming it. */
function refuseCopy(record: Record<string, unknown>, slug: string): never {
  const name = typeof record.name === "string" ? record.name : slug;
  const message = `${name} holds the field group ${slug}, whose fields are changed only in its own editor: a change there reaches every collection, Single and field group using it. Change ${slug} in its own editor.`;
  throw NextlyError.validation({
    errors: [{ path: name, code: "FIELD_GROUP_READ_ONLY", message }],
    logContext: { fieldGroup: slug, field: name },
  });
}
