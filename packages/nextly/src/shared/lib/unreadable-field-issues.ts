/**
 * What a validation refusal may tell its caller about the document it judged.
 *
 * A write is validated as the document it would store, which can hold fields
 * the caller may not read: a publish judges every stored value, not only the
 * ones the caller sent. An issue on such a field tells the caller about its
 * hidden value — "must be at most 10" that it is over 10, "is required" that
 * it is empty, and a validator's own message may carry the value itself. So
 * each issue rooted at a field the caller may not read, or at a row inside
 * one, is told as one generic issue instead. The refusal stands: only what it
 * says changes. The issues withheld go to the server log.
 *
 * "May not read" is the read redaction's own answer, asked of a copy of the
 * judged document: the entity's field rules (`applyFieldReadAccess`), then the
 * rules of the field groups it holds (`liveFieldGroupReadPass`), as a read of
 * that document runs them. A field is withheld here exactly where that read
 * would remove it.
 *
 * @module shared/lib/unreadable-field-issues
 */
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { FieldConfig } from "../../collections/fields/types";
import {
  liveFieldGroupReadPass,
  type FieldGroupFieldsSource,
} from "../../domains/field-groups/live-read-access";
import { consoleLogger } from "../types";

import type { ValidationIssue } from "./entry-validation";
import {
  applyFieldReadAccess,
  callerAccessGrants,
  type CallerGrants,
} from "./field-level-registry";

/** The one issue every withheld issue is told as. */
export const UNREADABLE_FIELD_ISSUE: ValidationIssue = {
  path: "",
  code: "UNREADABLE_FIELD",
  message: "A field you can't see doesn't pass validation.",
};

/** Who is told the refusal, as a read of the same document would judge them. */
export interface IssueReader {
  user?: Record<string, unknown>;
  authenticatedScope?: AuthenticatedScope;
  /** Trusted code is told every issue, as it reads every field. */
  overrideAccess?: boolean;
  /**
   * The caller's grants where the write already resolved them, so a field
   * rule asking for one reads no row inside the write's transaction.
   */
  grants?: () => Promise<CallerGrants>;
}

type ReadKind = Parameters<typeof applyFieldReadAccess>[0]["kind"];

/** One step of an issue's path: a field name or a row index. */
type PathStep = string | number;

/**
 * `items[2].title` → `["items", 2, "title"]`; `[]` for an issue on the
 * document as a whole, and `null` for a path this cannot read.
 */
function stepsOf(path: string): PathStep[] | null {
  if (path === "") return [];
  const steps: PathStep[] = [];
  for (const part of path.split(".")) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) return null;
    steps.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) {
      steps.push(Number(index[1]));
    }
  }
  return steps;
}

/** The container a step is taken from, where it is one. */
function asContainer(value: unknown): Record<PathStep, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<PathStep, unknown>)
    : undefined;
}

/**
 * Give an issue's own field a value where the document has none, so the read
 * rules judge it: a required field left empty is often absent, and a rule is
 * asked only of a field the document holds. Only the last step is filled, and
 * only inside a container the document already has.
 */
function holdIssueField(document: Record<string, unknown>, steps: PathStep[]) {
  let at: unknown = document;
  for (const step of steps.slice(0, -1)) at = asContainer(at)?.[step];
  const container = asContainer(at);
  const last = steps.at(-1);
  if (container && last !== undefined && !(last in container)) {
    container[last] = null;
  }
}

/**
 * Whether the read removed a step of `steps`: a step the judged document holds
 * and the redacted copy does not.
 */
function removedAlong(
  judged: Record<string, unknown>,
  redacted: Record<string, unknown>,
  steps: PathStep[]
): boolean {
  let before: unknown = judged;
  let after: unknown = redacted;
  for (const step of steps) {
    const from = asContainer(before);
    if (!from || !(step in from)) return false;
    const to = asContainer(after);
    if (!to || !(step in to)) return true;
    before = from[step];
    after = to[step];
  }
  return false;
}

/**
 * `issues` as `reader` may be told them about `document`: every issue rooted
 * at a field the reader may not read collapsed into
 * {@link UNREADABLE_FIELD_ISSUE}, once, where the first of them stood; the
 * rest as they are. Asked only of a refusal, so a valid write pays nothing.
 */
export async function issuesTheReaderMaySee(
  issues: ValidationIssue[],
  args: {
    kind: ReadKind;
    slug: string;
    /** The document the issues were found in, as validation was shown it. */
    document: Record<string, unknown>;
    /** The entity's fields, for the field groups the document holds. */
    fields: readonly FieldConfig[];
    /** Where those field groups' own fields are read. */
    fieldGroups?: FieldGroupFieldsSource;
    /** A write's transaction connection, where the issues were found in one. */
    executor?: unknown;
    reader: IssueReader;
  }
): Promise<ValidationIssue[]> {
  if (issues.length === 0 || args.reader.overrideAccess === true) {
    return issues;
  }
  const located = issues.map(issue => ({ issue, steps: stepsOf(issue.path) }));
  // Two copies: the judged document with each issue's field held, and the
  // same after the read removes what the reader may not see. The document
  // itself belongs to the write and is left as it is.
  let judged: Record<string, unknown>;
  try {
    judged = structuredClone(args.document);
  } catch {
    // A document that cannot be copied cannot be judged field by field, so
    // every issue on a field is withheld.
    return collapse(located, () => true, args);
  }
  for (const { steps } of located) {
    if (steps) holdIssueField(judged, steps);
  }
  const redacted = structuredClone(judged);
  const { user, authenticatedScope } = args.reader;
  const grants =
    args.reader.grants ??
    callerAccessGrants(user, authenticatedScope, args.executor);
  await applyFieldReadAccess({
    kind: args.kind,
    slug: args.slug,
    entry: redacted,
    user,
    authenticatedScope,
    grants,
  });
  const fieldGroupPass = await liveFieldGroupReadPass(
    args.fields,
    args.fieldGroups
  );
  await fieldGroupPass?.(redacted, { user, authenticatedScope, grants });
  return collapse(
    located,
    steps => removedAlong(judged, redacted, steps),
    args
  );
}

function collapse(
  located: Array<{ issue: ValidationIssue; steps: PathStep[] | null }>,
  withheld: (steps: PathStep[]) => boolean,
  args: { kind: ReadKind; slug: string }
): ValidationIssue[] {
  const told: ValidationIssue[] = [];
  const kept: ValidationIssue[] = [];
  for (const { issue, steps } of located) {
    // An issue on the document as a whole names no field; one whose path
    // cannot be read is withheld, as it may name one.
    if (steps === null || (steps.length > 0 && withheld(steps))) {
      if (kept.length === 0) told.push(UNREADABLE_FIELD_ISSUE);
      kept.push(issue);
    } else {
      told.push(issue);
    }
  }
  if (kept.length > 0) {
    consoleLogger.info(
      "A validation refusal withheld issues on fields its caller may not read",
      { kind: args.kind, slug: args.slug, withheldIssues: kept }
    );
  }
  return told;
}
