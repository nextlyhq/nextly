/**
 * A field a caller may not READ is a field it may not FILTER on.
 *
 * Field-level read rules redact values from rows that have ALREADY been
 * selected. That makes them powerless against a `where`: the row set itself
 * varies with the hidden value, so a caller can ask `equals` each candidate and
 * read the answer off which query returns the row. The value is never rendered,
 * so redaction never sees it leave.
 *
 * This closes the input side, where redaction cannot reach.
 *
 * @module shared/lib/filterable-fields
 * @since 1.0.0
 */

import { NextlyError } from "../../errors/nextly-error";

import { getFieldFunctions } from "./field-level-registry";

type EntityKind = "collection" | "single";

/** Keys that structure a filter rather than naming a field. */
const STRUCTURAL_KEYS = new Set(["and", "or"]);

/**
 * Field names a filter refers to, at any nesting depth.
 *
 * `and`/`or` carry arrays of nested filters; everything else is a leaf whose
 * KEY is a field name and whose value is the operator object.
 */
function referencedFields(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) referencedFields(child, into);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (STRUCTURAL_KEYS.has(key)) {
      referencedFields(value, into);
      continue;
    }
    // `a.b` addresses a nested field; the guard below is keyed on the field
    // that OWNS the rule, so compare on the first segment.
    into.add(key.split(".")[0]);
  }
}

/**
 * Refuse a filter that names a field carrying a read rule.
 *
 * **Conservative by construction, and deliberately so.** A field read rule is a
 * function of the ROW — it may consult `data` or `id` — and at query time there
 * is no row to judge, so "may this caller read this field" is not yet
 * answerable. Rather than guess, this refuses any field that CAN deny. Fields
 * with no read rule, which is nearly all of them, are untouched.
 *
 * That direction is forced rather than chosen: this is a precondition, and a
 * precondition that cannot decide must fail closed. Guessing "allowed" here
 * would hand back exactly the disclosure the module exists to stop.
 *
 * Refusing NAMES the field. That discloses the field is restricted, which the
 * caller already learns from its absence in every response, and it is the
 * difference between an API a developer can work with and one that silently
 * returns the wrong rows.
 */
export function assertFilterableFields(
  kind: EntityKind,
  slug: string,
  where: unknown,
  opts: { overrideAccess?: boolean } = {}
): void {
  // A trusted caller has already decided who is asking.
  if (opts.overrideAccess) return;
  if (!where) return;

  const fns = getFieldFunctions(kind, slug);
  if (!fns) return;

  const referenced = new Set<string>();
  referencedFields(where, referenced);
  if (referenced.size === 0) return;

  const denied = [...referenced]
    .filter(name => fns[name]?.access?.read !== undefined)
    .sort();
  if (denied.length === 0) return;

  throw NextlyError.validation({
    errors: denied.map(field => ({
      path: `where.${field}`,
      code: "FIELD_NOT_FILTERABLE",
      message: `The field "${field}" carries a read rule, so it cannot be used to filter. Filtering on a field you may not read would reveal its contents through the rows returned.`,
    })),
  });
}
