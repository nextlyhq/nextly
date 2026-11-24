/**
 * A field group's fields are read-only inside the collections, Singles and field groups that use
 * it: they are changed only in the field group's own editor, which reaches every user at once. A
 * host's save carries a field group as a reference; one that also carries the field group's fields
 * (`fields`, or the `componentFields` and `componentSchemas` a read hands out) is refused, naming
 * the field group, where they differ from the field group's own, by a field added, removed, edited
 * or reordered. A copy that matches is the read's own echo and changes nothing.
 *
 * @module dispatcher/helpers/field-group-fields-read-only
 */
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "../../domains/field-groups/storage/field-group-field-type";
import { NextlyError } from "../../errors";
import { deepEqual } from "../../shared/lib/deep-equal";

import { getComponentRegistryFromDI } from "./di";

/** What a read adds to a field-group field beside its reference, which is not its definition. */
const DERIVED = ["componentFields", "componentSchemas"] as const;

/** `fields` with what a read adds to each field-group field taken away, at any depth. */
function withoutDerived(fields: unknown): unknown {
  if (!Array.isArray(fields)) return fields;
  return fields.map(field => {
    if (field === null || typeof field !== "object") return field;
    const copy: Record<string, unknown> = { ...field };
    for (const key of DERIVED) delete copy[key];
    if (Array.isArray(copy.fields)) copy.fields = withoutDerived(copy.fields);
    return copy;
  });
}

/** The copies of field groups' fields one field-group field carries, by the field group they copy. */
function copiesIn(field: Record<string, unknown>): Map<string, unknown> {
  const { single } = extractFieldGroupReferences(field);
  const copies = new Map<string, unknown>();
  const inline = field.fields ?? field.componentFields;
  if (single !== undefined && Array.isArray(inline)) copies.set(single, inline);
  const schemas = field.componentSchemas;
  if (schemas !== null && typeof schemas === "object") {
    for (const [slug, schema] of Object.entries(schemas)) {
      const list = (schema as { fields?: unknown } | null)?.fields;
      if (Array.isArray(list)) copies.set(slug, list);
    }
  }
  return copies;
}

/**
 * Refuses a host's save that changes the fields of a field group it uses, before anything is
 * written. Each field-group field the save carries, in a group or repeater too, is compared, by
 * every copy of a field group's fields it carries, with that field group's stored fields. A field
 * group the registry does not hold is left to the save's own checks.
 */
export async function refuseFieldGroupFieldsChangedInHost(
  fields: unknown
): Promise<void> {
  const registry = getComponentRegistryFromDI();
  if (registry === undefined) return;
  const pending: unknown[] = Array.isArray(fields) ? [...fields] : [];
  for (let field = pending.pop(); field !== undefined; field = pending.pop()) {
    if (field === null || typeof field !== "object") continue;
    const record = field as Record<string, unknown>;
    if (isFieldGroupFieldType(record.type)) {
      await refuseChangedCopies(record, registry);
    } else if (Array.isArray(record.fields)) {
      pending.push(...record.fields);
    }
  }
}

/**
 * Refuses one field-group field whose copies of field groups' fields differ from what those field
 * groups store, naming the field group.
 */
async function refuseChangedCopies(
  record: Record<string, unknown>,
  registry: NonNullable<ReturnType<typeof getComponentRegistryFromDI>>
): Promise<void> {
  for (const [slug, copy] of copiesIn(record)) {
    const stored = await registry.getComponentBySlug(slug);
    if (stored === null) continue;
    if (deepEqual(withoutDerived(copy), withoutDerived(stored.fields))) {
      continue;
    }
    const name = typeof record.name === "string" ? record.name : slug;
    const message = `${name} holds the field group ${slug}, whose fields are changed only in its own editor: a change there reaches every collection, Single and field group using it. Change ${slug} in its own editor.`;
    throw NextlyError.validation({
      errors: [{ path: name, code: "FIELD_GROUP_READ_ONLY", message }],
      logContext: { fieldGroup: slug, field: name },
    });
  }
}
