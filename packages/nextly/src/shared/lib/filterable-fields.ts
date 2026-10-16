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

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { NextlyError } from "../../errors/nextly-error";

import { toCamelCase, toSnakeCase } from "./case-conversion";
import {
  callerAccessGrants,
  getFieldFunctions,
  readableWithoutEntry,
  type FieldFunctions,
} from "./field-level-registry";

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
  // `a.b` addresses a nested field; the guard below is keyed on the field
  // that OWNS the rule, so compare on the first segment.
  for (const key of filterKeys(node)) into.add(key.split(".")[0]);
}

/**
 * Every key a filter names, whole, at any nesting depth: `a.b` stays `a.b`.
 *
 * The one walk of a filter's shape. `referencedFields` reduces it to the
 * owning fields, and a caller judging where a dotted key resolves (a
 * component table rather than the entity's own) reads the whole key from it.
 */
export function filterKeys(
  node: unknown,
  into = new Set<string>()
): Set<string> {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const child of node) filterKeys(child, into);
    return into;
  }
  for (const [key, value] of Object.entries(node)) {
    if (STRUCTURAL_KEYS.has(key)) filterKeys(value, into);
    else into.add(key);
  }
  return into;
}

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
  // BOTH directions. Converting only to camel closed the snake-spelled probe
  // against a camel-declared field and left its mirror open: a field declared
  // `secret_answer` is missed by `groupBy=secretAnswer`, because the camel form
  // of an already-camel string is itself and the registry key is the snake one.
  // The resolvers downstream try both spellings when they look up a column, so
  // a guard that tries one is a guard with an alias around it.
  return [...new Set([name, toCamelCase(name), toSnakeCase(name)])];
}

/**
 * Whether a read hands back something other than what the column stores.
 *
 * `afterRead` runs per ROW on the way out, so at query time there is no row to
 * judge and "does this hook mask the value" is not yet answerable -- the same
 * position `carriesReadRule` is in, and it gets the same conservative answer.
 * A hook that merely formats is refused alongside one that masks, because the
 * two are indistinguishable from here and guessing wrong on the second
 * publishes the value the hook exists to withhold.
 */
function transformsOnRead(fn: FieldFunctions | undefined): boolean {
  if (!fn) return false;
  if ((fn.hooks?.afterRead?.length ?? 0) > 0) return true;
  return Object.values(fn.fields ?? {}).some(transformsOnRead);
}

/** Field names whose stored value is not the value a read returns. */
function transformedFields(
  kind: EntityKind,
  slug: string,
  names: Iterable<string>
): string[] {
  const fns = getFieldFunctions(kind, slug);
  if (!fns) return [];
  return [...names]
    .filter(name => spellings(name).some(n => transformsOnRead(fns[n])))
    .sort();
}

/** Who is asking a query: the caller whose read rules are judged. */
export interface QueryCaller {
  user?: Record<string, unknown>;
  /** The caller's own grants when they arrived on an API key. */
  authenticatedScope?: AuthenticatedScope;
}

/**
 * Field names, as the caller wrote them, that this caller may not read when no
 * entry is given — so may not use to select, order, group or match rows.
 *
 * A field read rule is asked the question it is written to answer, for this
 * caller, with no entry: a rule allowing the caller outright (by role,
 * permission or identity) lets the field be queried, and a rule that refuses,
 * throws, or needs an entry to decide does not. The last is what keeps a field
 * readable only on some entries out of every query: a predicate, an ordering
 * or a match would reveal its value on the entries where it is hidden.
 *
 * Judged under every spelling the name reaches the column by, so
 * `secret_answer` is refused wherever `secretAnswer` is. The caller's grants
 * are read once, and only if a named field carries a rule.
 */
async function unreadableFields(
  kind: EntityKind,
  slug: string,
  names: Iterable<string>,
  caller: QueryCaller
): Promise<string[]> {
  const fns = getFieldFunctions(kind, slug);
  if (!fns) return [];
  const ruleCaller = {
    user: caller.user,
    grants: callerAccessGrants(caller.user, caller.authenticatedScope),
  };
  const denied: string[] = [];
  for (const name of new Set(names)) {
    for (const spelled of spellings(name)) {
      const field = fns[spelled];
      if (!field) continue;
      // A rule-bearing field whose read value is not its stored value stays
      // out however the rule answers: every row shows the transformed value,
      // so a query on the stored one probes exactly what the rows hide.
      const hidden =
        (carriesReadRule(field) && transformsOnRead(field)) ||
        !(await readableWithoutEntry(field, ruleCaller));
      if (hidden) {
        denied.push(name);
        break;
      }
    }
  }
  return denied.sort();
}

/** The head of a dotted key: the field that owns any rule on its path. */
const ownerOf = (key: string): string => key.split(".")[0];

/** Where a field was named, and what naming it there would disclose. */
type Position = "where" | "sort" | "groupBy";

/**
 * One row per position, rather than a ternary chain.
 *
 * A table because each position leaks the same hidden value by a DIFFERENT
 * route, so each refusal has to say which route -- and a chain that grows a
 * branch per position stops being readable at exactly the point a third one
 * arrives.
 */
const REFUSALS: Record<Position, { code: string; because: string }> = {
  where: {
    code: "FIELD_NOT_FILTERABLE",
    because:
      "Filtering on a field you may not read would reveal its contents through the rows returned.",
  },
  sort: {
    code: "FIELD_NOT_SORTABLE",
    because:
      "Ordering by a field you may not read reveals how its values compare across rows.",
  },
  groupBy: {
    code: "FIELD_NOT_GROUPABLE",
    because:
      "Grouping by a field you may not read publishes its distinct values as the buckets themselves, which redaction never sees because the value is never rendered in a row.",
  },
};

/**
 * The errors a read-rule refusal carries, without throwing them.
 *
 * Split from `refuse` so a caller that must ANSWER whether a field is usable
 * reads the same refusal a caller that GATES on it throws -- rather than the
 * two composing the underlying checks separately and drifting apart.
 */
function refusalFor(
  fields: string[],
  at: Position
): Array<{ path: string; code: string; message: string }> {
  const { code, because } = REFUSALS[at];
  return fields.map(field => ({
    path: `${at}.${field}`,
    code,
    message: `"${field}" is a field you may not read, or may read only on some entries, so it cannot be used to ${at === "groupBy" ? "group" : at === "sort" ? "sort" : "filter"}. ${because}`,
  }));
}

function refuse(fields: string[], at: Position): never {
  throw NextlyError.validation({ errors: refusalFor(fields, at) });
}

/**
 * Refuse a filter that names a field this caller may not read.
 *
 * A field read rule is a function of the ROW — it may consult `data` or `id`
 * — and at query time there is no row, so the rule is asked for this caller
 * with no entry (see `unreadableFields`). A rule that cannot allow without an
 * entry refuses: this is a precondition, and a precondition that cannot decide
 * must fail closed. Fields with no read rule, which is nearly all of them, are
 * untouched.
 *
 * Refusing NAMES the key as the caller wrote it. That discloses the field is
 * restricted, which the caller already learns from its absence in every
 * response, and it is the difference between an API a developer can work with
 * and one that silently returns the wrong rows.
 *
 * **Judge the CALLER's filter, not the settled one.** A `beforeRead` or
 * `beforeOperation` hook is trusted server code and narrows reads on purpose,
 * sometimes by a protected column — a tenant scope is the ordinary case.
 * Handing this the post-hook predicate would reject the very reads those hooks
 * exist to make safe.
 */
export async function assertFilterableFields(
  kind: EntityKind,
  slug: string,
  where: unknown,
  opts: {
    overrideAccess?: boolean;
    frameworkFilter?: boolean;
    caller?: QueryCaller;
  } = {}
): Promise<void> {
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

  const keys = [...filterKeys(where)];
  if (keys.length === 0) return;

  // Judged by the field that owns the rule; named as the caller wrote it.
  const denied = new Set(
    await unreadableFields(kind, slug, keys.map(ownerOf), opts.caller ?? {})
  );
  const refused = keys.filter(key => denied.has(ownerOf(key))).sort();
  if (refused.length > 0) refuse(refused, "where");
}

/**
 * Refuse a filter that names a column hidden from the entry API.
 *
 * A column a schema hook contributes as hidden is stripped from every row a
 * read returns, but a filter on it changes WHICH rows come back, so a caller
 * could guess its value one query at a time and read the answer off the
 * result. Judged for every caller, trusted or not, because the strip applies
 * to trusted reads too, and refused rather than ignored: ignoring a filter
 * answers a wider question than the one asked.
 *
 * `isHidden` is the read table's `hiddenColumnMatcher`, so a key is judged in
 * either spelling; nested `and`/`or` leaves and the first segment of a dotted
 * path are judged as `assertFilterableFields` judges them. A dotted path that
 * reaches a component table names that table's columns, not this one's, so
 * the caller judges it against the component table as well.
 */
export function assertNoHiddenColumnFilter(
  where: unknown,
  isHidden: (key: string) => boolean
): void {
  const referenced = new Set<string>();
  referencedFields(where, referenced);
  refuseHiddenColumnFilter([...referenced].filter(isHidden));
}

/**
 * Refuse these filter keys, each found to name a hidden column, if any.
 *
 * The one refusal for a filter on a hidden column, whichever table the key
 * resolves to: the entity's own, judged by `assertNoHiddenColumnFilter`, or a
 * component table a dotted key reaches, judged by its caller against that
 * table's `hiddenColumnMatcher`.
 */
export function refuseHiddenColumnFilter(keys: readonly string[]): void {
  if (keys.length === 0) return;
  throw NextlyError.validation({
    errors: [...keys].sort().map(field => ({
      path: `where.${field}`,
      code: REFUSALS.where.code,
      message: `"${field}" is not a column on this collection, so there is nothing to filter on.`,
    })),
  });
}

/**
 * Refuse an ORDER BY that names a field this caller may not read.
 *
 * Sorting leaks the same value more slowly. The rows come back redacted, but
 * their ORDER is a comparison of the hidden column, and a caller who can create
 * rows with chosen anchor values can bisect a neighbour's value from where it
 * lands between them. A guard on the filter alone leaves that open.
 */
export async function assertSortableField(
  kind: EntityKind,
  slug: string,
  sort: string | undefined,
  opts: {
    overrideAccess?: boolean;
    frameworkFilter?: boolean;
    caller?: QueryCaller;
  } = {}
): Promise<void> {
  if (opts.overrideAccess || opts.frameworkFilter || !sort) return;
  // `-field` is descending; the field is the same either way.
  const written = sort.replace(/^-/, "");
  const denied = await unreadableFields(
    kind,
    slug,
    [ownerOf(written)],
    opts.caller ?? {}
  );
  if (denied.length > 0) refuse([written], "sort");
}

/**
 * Why this field cannot be a group key whoever asks, if it cannot.
 *
 * The caller-independent half of the group-key decision: a key that is not a
 * string, or one naming a field whose stored value is not what a read returns.
 * Whether THIS caller may read the field is the other half, asked by
 * `assertGroupableField`; both read this, so a restriction added here reaches
 * the read and the widget source alike.
 */
export function groupableFieldProblem(
  kind: EntityKind,
  slug: string,
  groupBy: unknown
): Array<{ path: string; code: string; message: string }> | undefined {
  // `undefined` means "no group key was given", and an empty string is the same
  // absence spelled differently. Anything else non-string is MALFORMED, and is
  // refused here rather than reaching `.split` or `toSnakeCase` -- whose
  // `.replace` throws a raw `TypeError` the calling service catches as an
  // unclassified 500. Checked BEFORE the absence test, because `0`, `false` and
  // `NaN` are falsy AND wrong: treating them as absent let them through to
  // exactly the crash this exists to replace.
  //
  // `null` is MALFORMED here rather than absent, and the difference is not a
  // preference. Every read that consumes this decides absence with
  // `groupBy === undefined`, so a `null` this waved through as "no key given"
  // was still a key as far as they were concerned, and it reached `toSnakeCase`
  // -- the crash this function exists to replace, arriving through the one
  // value it excused. The API asks for a required string on both paths
  // (`GroupArgs.groupBy`, `TimeseriesArgs.dateField`), so no caller can mean
  // "absent" by writing `null`; only an untyped one reaches here with it, and a
  // named refusal is what it should get.
  if (groupBy === undefined) return undefined;
  if (typeof groupBy !== "string") {
    return [
      {
        path: "groupBy",
        code: "FIELD_NOT_GROUPABLE",
        message: "The field to group by must be given as a string.",
      },
    ];
  }
  if (groupBy === "") return undefined;

  // A transform asks what the value IS, and that answer does not change with
  // the caller: a trusted grouped read would still publish stored values as
  // labels while a list of the same rows shows the transformed ones, and the
  // two describing the same rows differently is the defect whatever the
  // caller's trust.
  const transformed = transformedFields(kind, slug, [ownerOf(groupBy)]);
  if (transformed.length > 0) {
    return transformed.map(field => ({
      path: `groupBy.${field}`,
      code: "FIELD_NOT_GROUPABLE",
      message: `The field "${field}" is transformed when it is read, so its stored value is not the one a read returns. Grouping would publish the stored value as a bucket label, past the hook that changes it.`,
    }));
  }
  return undefined;
}

/**
 * Whether a widget source should offer this field as a group key.
 *
 * A source is one list for every caller, so it cannot ask whether a given
 * caller may read the field: it offers only fields no read rule can refuse,
 * on top of the caller-independent half of the decision. A caller a rule
 * allows can still group by the field directly.
 */
export function isGroupableFieldName(
  kind: EntityKind,
  slug: string,
  name: string
): boolean {
  if (groupableFieldProblem(kind, slug, name) !== undefined) return false;
  const fns = getFieldFunctions(kind, slug);
  return !spellings(ownerOf(name)).some(n => carriesReadRule(fns?.[n]));
}

/**
 * Refuse a GROUP BY this caller may not make.
 *
 * 🔴 A third disclosure route, and the one the other two guards do not cover.
 * `where` leaks a hidden value through which rows come back and `sort` through
 * where they land; grouping leaks it MORE directly than either, because the
 * distinct values become the buckets. A caller never sees the column -- field
 * redaction strips it from every row -- and reads the whole value set off the
 * labels instead. Selecting the field is not required, and refusing it does not
 * help: the answer is the grouping, not the row.
 *
 * The caller-independent problems apply to every caller, trusted or not; the
 * read rule is asked of the caller as `where` asks it.
 */
export async function assertGroupableField(
  kind: EntityKind,
  slug: string,
  groupBy: string | undefined,
  opts: {
    overrideAccess?: boolean;
    frameworkFilter?: boolean;
    caller?: QueryCaller;
  } = {}
): Promise<void> {
  const errors = groupableFieldProblem(kind, slug, groupBy);
  if (errors) throw NextlyError.validation({ errors });
  if (opts.overrideAccess || opts.frameworkFilter || !groupBy) return;
  const denied = await unreadableFields(
    kind,
    slug,
    [ownerOf(groupBy)],
    opts.caller ?? {}
  );
  if (denied.length > 0) refuse([groupBy], "groupBy");
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
 * through which rows come back. A field readable only on some entries is left
 * out for the same reason it may not be filtered on.
 */
export async function filterSearchableFields(
  kind: EntityKind,
  slug: string,
  fields: string[],
  opts: { overrideAccess?: boolean; caller?: QueryCaller } = {}
): Promise<string[]> {
  if (opts.overrideAccess) return fields;
  const denied = new Set(
    await unreadableFields(kind, slug, fields, opts.caller ?? {})
  );
  return fields.filter(name => !denied.has(name));
}
