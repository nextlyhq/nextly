/**
 * What a code rule's answer means, judged in one place.
 *
 * A rule answers `true` to allow. A collection's read, update, delete,
 * publish and unpublish rules may instead answer a filter over the
 * collection's entries, which allows only the entries it matches. Anything
 * else refuses: `false`, `null`, `undefined`, a truthy value that is not
 * `true`, and a filter that is not well formed.
 *
 * The decision and every way in that still judges a rule's answer on its own
 * read the answer through {@link ruleAnswer}, so no two of them can come to
 * read the same answer differently.
 *
 * @module auth/access/rule-answer
 */
import {
  filterShapeProblems,
  snapshotFilter,
  type FilterProblem,
} from "../../domains/collections/query/filter-shape";
import { NextlyError } from "../../errors/nextly-error";
import { consoleLogger } from "../../shared/types";

/** A filter over a collection's entries, as a rule answers it. */
export type RuleFilter = Readonly<Record<string, unknown>>;

/** What a rule's answer means. */
export type RuleAnswer =
  | { readonly kind: "allow" }
  | { readonly kind: "filter"; readonly filter: RuleFilter }
  | {
      readonly kind: "malformed-filter";
      readonly problems: readonly FilterProblem[];
    }
  | { readonly kind: "refuse" };

const ALLOW: RuleAnswer = Object.freeze({ kind: "allow" });
const REFUSE: RuleAnswer = Object.freeze({ kind: "refuse" });

/**
 * What a rule's answer means: `true` allows, plain data is a filter, well
 * formed or not, and anything else refuses, an instance of a class included.
 *
 * Each call reads the answer afresh, into a copy of its own, so an answer is
 * read once per rule call by asking here once and keeping the meaning (as
 * the decision's rule outcome does). Never kept by the answer object: a rule
 * may hand back one object it rewrites for each caller.
 */
export function ruleAnswer(value: unknown): RuleAnswer {
  if (value === true) return ALLOW;
  if (!isPlainData(value)) return REFUSE;
  return filterMeaning(value);
}

/**
 * Whether `value` is an object of data alone: a plain object, or one with no
 * prototype. A `Map`, a `URL` or any other class instance is not, and neither
 * is a value whose prototype cannot be read.
 */
function isPlainData(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Why an answer could not be read as a filter at all. */
const UNREADABLE: FilterProblem = Object.freeze({
  path: "where",
  code: "FILTER_UNREADABLE",
  message:
    "the filter could not be read: it refers to itself, nests too deeply, or failed as it was read",
});

/**
 * An answer judged as a filter. It is copied once, each property read once,
 * and the copy is both what is judged and the filter handed on, so nothing
 * read from the answer afterwards can change what it allows. An answer that
 * cannot be copied, one that refers to itself or nests too deeply or throws
 * as it is read, is not well formed.
 */
function filterMeaning(value: object): RuleAnswer {
  let filter: Record<string, unknown>;
  let problems: FilterProblem[];
  try {
    filter = snapshotFilter(value as Record<string, unknown>);
    problems = filterShapeProblems(filter);
  } catch {
    return Object.freeze({ kind: "malformed-filter", problems: [UNREADABLE] });
  }
  return Object.freeze(
    problems.length === 0
      ? { kind: "filter", filter }
      : { kind: "malformed-filter", problems }
  );
}

/** The actions whose rule may answer with a filter, on a collection. */
const FILTERABLE: ReadonlySet<string> = new Set([
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
]);

/**
 * Whether a rule for `action` on a target of `kind` may answer with a filter:
 * a collection's read, update, delete, publish and unpublish rules. A create
 * has no entries yet to match, and a Single is one entry, so a filter from
 * either is a misuse.
 */
export function mayAnswerFilter(
  kind: "collection" | "single",
  action: string
): boolean {
  return kind === "collection" && FILTERABLE.has(action);
}

/** Filter misuses already reported, so each is reported once per process. */
const reported = new Set<string>();

/**
 * Reports a rule's filter that refuses the caller: one that is not well
 * formed, or one from a rule that may not answer with a filter. The deny
 * stands either way. The report names the rule's collection and operation,
 * for whoever maintains it, and never the filter's content, which a rule may
 * have built from the caller's data. In development it is raised as an error
 * as well, so the misuse shows where it is made.
 */
export function reportRuleFilterMisuse(
  slug: string,
  action: string,
  kind: "collection" | "single",
  answer: RuleAnswer
): void {
  const misplaced = answer.kind === "filter" && !mayAnswerFilter(kind, action);
  if (answer.kind !== "malformed-filter" && !misplaced) return;
  const problem =
    answer.kind === "malformed-filter"
      ? // By its problems' codes alone: a path or a message repeats the
        // filter's keys, which a rule may have built from the caller's data.
        `answered a filter that is not well formed (${[
          ...new Set(answer.problems.map(p => p.code)),
        ].join(", ")})`
      : kind === "single"
        ? "answered a filter, but a Single's rule may only answer true or false"
        : "answered a filter, but a create rule may only answer true or false";
  const message = `[rbac] The ${action} rule of "${slug}" ${problem}, so the caller is refused.`;
  const key = `${slug}:${action}:${answer.kind}`;
  if (!reported.has(key)) {
    reported.add(key);
    consoleLogger.error(message);
  }
  if (process.env.NODE_ENV === "development") {
    throw NextlyError.internal({
      logContext: { reason: "rule-filter-misuse", slug, action, message },
    });
  }
}

/** Forgets what has been reported, so a test can watch the first report. */
export function clearRuleFilterReports(): void {
  reported.clear();
}
