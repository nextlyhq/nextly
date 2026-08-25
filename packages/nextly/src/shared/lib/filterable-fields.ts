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

import { toCamelCase } from "./case-conversion";
import { getFieldFunctions, type FieldFunctions } from "./field-level-registry";

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
/**
 * Whether this field, or anything nested inside it, carries a read rule.
 *
 * A `group` or `repeater` may carry no rule itself while a child does. The
 * container is still not filterable: these are stored as JSON, and on SQLite as
 * TEXT, so `contains` against the serialised container probes the child's value
 * without ever naming it. Judging only the container's own `access.read` reads
 * the outer object and misses what it holds.
 */
function carriesReadRule(fn: FieldFunctions | undefined): boolean {
  if (!fn) return false;
  if (fn.access?.read !== undefined) return true;
  return Object.values(fn.fields ?? {}).some(carriesReadRule);
}

/**
 * Every spelling a query may reach one field by.
 *
 * The registry is keyed by field NAME, and the ORDER BY path resolves a sort
 * against either the name or its snake_case COLUMN (`f.name === sortField ||
 * f.column === sortFieldSnake`). So `sort=secret_answer` addresses the same
 * hidden column as `sort=secretAnswer` while looking like a different string,
 * and a guard keyed on the raw spelling refuses one and waves the other
 * through. Judging both closes the alias without needing the schema here.
 */
function spellings(name: string): string[] {
  const camel = toCamelCase(name);
  return camel === name ? [name] : [name, camel];
}

/** Field names the caller may not use to select or order rows. */
function protectedFields(
  kind: EntityKind,
  slug: string,
  names: Iterable<string>
): string[] {
  const fns = getFieldFunctions(kind, slug);
  if (!fns) return [];
  return [...names]
    .filter(name => spellings(name).some(n => carriesReadRule(fns[n])))
    .sort();
}

function refuse(fields: string[], at: "where" | "sort"): never {
  throw NextlyError.validation({
    errors: fields.map(field => ({
      path: `${at}.${field}`,
      code: at === "sort" ? "FIELD_NOT_SORTABLE" : "FIELD_NOT_FILTERABLE",
      message:
        at === "sort"
          ? `The field "${field}" carries a read rule, so it cannot be used to sort. Ordering by a field you may not read reveals how its values compare across rows.`
          : `The field "${field}" carries a read rule, so it cannot be used to filter. Filtering on a field you may not read would reveal its contents through the rows returned.`,
    })),
  });
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
 *
 * **Judge the CALLER's filter, not the settled one.** A `beforeRead` or
 * `beforeOperation` hook is trusted server code and narrows reads on purpose,
 * sometimes by a protected column — a tenant scope is the ordinary case.
 * Handing this the post-hook predicate would reject the very reads those hooks
 * exist to make safe.
 */
export function assertFilterableFields(
  kind: EntityKind,
  slug: string,
  where: unknown,
  opts: { overrideAccess?: boolean; frameworkFilter?: boolean } = {}
): void {
  // A trusted caller has already decided who is asking.
  if (opts.overrideAccess) return;

  // The framework built this filter itself, from a route it was asked to
  // render, rather than receiving it from a request. The disclosure needs a
  // caller CHOOSING probe values; framework lookups do not choose, they address.
  //
  // This is deliberately NOT a config field. `mergeConfig` fills anything a
  // nested Direct API call omits from the instance defaults -- the hazard
  // `direct-api/namespaces/helpers.ts` documents for `overrideAccess` and
  // `trusted` -- so an inheritable exemption would let a caller-supplied
  // `where` reaching a nested read acquire the framework's trust. It lives on
  // the per-operation arguments beside `where`, where absent means untrusted
  // and nothing can supply it on a caller's behalf.
  if (opts.frameworkFilter) return;
  if (!where) return;

  const referenced = new Set<string>();
  referencedFields(where, referenced);
  if (referenced.size === 0) return;

  const denied = protectedFields(kind, slug, referenced);
  if (denied.length > 0) refuse(denied, "where");
}

/**
 * Refuse an ORDER BY that names a field carrying a read rule.
 *
 * Sorting leaks the same value more slowly. The rows come back redacted, but
 * their ORDER is a comparison of the hidden column, and a caller who can create
 * rows with chosen anchor values can bisect a neighbour's value from where it
 * lands between them. A guard on the filter alone leaves that open.
 */
export function assertSortableField(
  kind: EntityKind,
  slug: string,
  sort: string | undefined,
  opts: { overrideAccess?: boolean; frameworkFilter?: boolean } = {}
): void {
  if (opts.overrideAccess || opts.frameworkFilter || !sort) return;
  // `-field` is descending; the field is the same either way.
  const name = sort.replace(/^-/, "").split(".")[0];
  const denied = protectedFields(kind, slug, [name]);
  if (denied.length > 0) refuse(denied, "sort");
}

/**
 * The searchable fields a caller may actually be matched against.
 *
 * Search is narrowed rather than refused, and the asymmetry with `where` is
 * deliberate. A caller naming a field in a filter asked about THAT field, and
 * silently ignoring them would answer a different question than the one asked.
 * A caller searching asked "find rows matching this text" and never named a
 * column, so dropping the ones they may not read answers exactly what they
 * asked — and leaving them in would let `search=alpha` probe a hidden value
 * through which rows come back.
 */
export function filterSearchableFields(
  kind: EntityKind,
  slug: string,
  fields: string[],
  opts: { overrideAccess?: boolean } = {}
): string[] {
  if (opts.overrideAccess) return fields;
  const fns = getFieldFunctions(kind, slug);
  if (!fns) return fields;
  return fields.filter(name => !carriesReadRule(fns[name]));
}
