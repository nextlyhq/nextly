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
 * says changes. The server log records which paths were withheld, never their
 * messages, which can carry the very values withheld.
 *
 * "May not read" is the read redaction's own answer, asked of a copy of the
 * judged document: the entity's field rules (`applyFieldReadAccess`), then the
 * rules of the field groups it holds (`liveFieldGroupReadPass`), then the
 * password strip every read makes, as a read of that document runs them.
 * Where this cannot be sure it answers as a read would, it withholds: when
 * the reader may not read the entry at all, every issue on a field; and when
 * the entity has a field `afterRead` hook, which a read runs between its
 * passes and may change what a rule decides, every issue on a field with a
 * read rule. It only ever withholds more than a read would hide, never less.
 *
 * @module shared/lib/unreadable-field-issues
 */
import {
  registeredReadLanguagesFor,
  withRuleLanguage,
} from "../../auth/access/rule-language";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { FieldConfig } from "../../collections/fields/types";
import {
  liveFieldGroupReadPass,
  type FieldGroupFieldsSource,
} from "../../domains/field-groups/live-read-access";
import { resolveComponentFieldMap } from "../../domains/versions/tag-component-types";
import { consoleLogger } from "../types";

import type { ValidationIssue } from "./entry-validation";
import {
  applyFieldReadAccess,
  callerAccessGrants,
  getFieldFunctions,
  type CallerGrants,
  type FieldFunctions,
} from "./field-level-registry";
import { stripPasswordFieldValues } from "./password-fields";

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
 * Whether `container` holds `step` itself. Never by inheritance: a field may
 * be named `toString`, which every object answers to.
 */
function holds(container: Record<PathStep, unknown>, step: PathStep): boolean {
  return Object.hasOwn(container, step);
}

/**
 * Give an issue's path a value where the document has none, so the read rules
 * judge it: a required field left empty is often absent, and a rule is asked
 * only of a field the document holds. Walked from the issue's root field: an
 * absent or empty group on the way is held as an empty group, so the group's
 * own rule and its child's are both asked, and an issue inside a hidden group
 * is withheld however little of it the document holds. Where the next step is
 * a row, which a document without the list cannot have, the list itself is
 * held, to be judged by its own rule. Whether anything was held.
 */
function holdIssuePath(
  document: Record<string, unknown>,
  steps: PathStep[]
): boolean {
  let at: Record<PathStep, unknown> | undefined = document;
  let changed = false;
  for (const [index, step] of steps.entries()) {
    if (!at) break;
    const next = steps[index + 1];
    changed = holdStep(at, step, next) || changed;
    at = next === undefined ? undefined : asContainer(at[step]);
  }
  return changed;
}

/**
 * Hold one step of a path: the issue's own field, or a list ahead of one of
 * its rows, as an empty value where it is absent; a group on the way as an
 * empty group where it is absent or empty. Whether it held anything.
 */
function holdStep(
  at: Record<PathStep, unknown>,
  step: PathStep,
  next: PathStep | undefined
): boolean {
  const asGroup = typeof next === "string";
  if (holds(at, step) && (!asGroup || at[step] != null)) return false;
  at[step] = asGroup ? {} : null;
  return true;
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
    if (!from || !holds(from, step)) return false;
    const to = asContainer(after);
    if (!to || !holds(to, step)) return true;
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
  args: IssueJudgement
): Promise<ValidationIssue[]> {
  if (issues.length === 0 || args.reader.overrideAccess === true) {
    return issues;
  }
  const located = issues.map(issue => ({ issue, steps: stepsOf(issue.path) }));
  const judge = async () => {
    const judged = await judgedDocument(args);
    if (!judged) return collapse(located, () => true, args);
    const withheld = await withheldIssues(located, judged, args);
    return collapse(located, (_steps, index) => withheld.has(index), args);
  };
  // Judged as a read of the document in its own language would be: a rule
  // can answer one language differently from every language at once.
  return args.readLocale === undefined
    ? judge()
    : withRuleLanguage(registeredReadLanguagesFor(args.readLocale), judge);
}

/** What {@link issuesTheReaderMaySee} judges issues by. */
interface IssueJudgement {
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
  /**
   * The stored entry's id, which a read rule is handed, where the judged
   * document does not carry it.
   */
  entryId?: string;
  /**
   * Whether the reader may read the stored entry at all, as the entity's
   * read gate answers; absent where nothing is stored yet.
   */
  rowReadable?: () => Promise<boolean>;
  /**
   * The language the document is one of, where a write judges several in
   * turn: its rules and read gate are asked as a read in that language.
   * Absent, they are asked in the write's own languages.
   */
  readLocale?: string;
  reader: IssueReader;
}

/**
 * A copy of the judged document, as a read of the stored entry would show it
 * to its rules; the document itself belongs to the write and is left as it
 * is. `undefined` where no field of it may be named: the reader may not read
 * the entry at all, so a read would show them none of it, or the document
 * cannot be copied, so it cannot be judged field by field.
 */
async function judgedDocument(
  args: IssueJudgement
): Promise<Record<string, unknown> | undefined> {
  if (args.rowReadable && !(await args.rowReadable())) return undefined;
  let judged: Record<string, unknown>;
  try {
    judged = structuredClone(args.document);
  } catch {
    return undefined;
  }
  if (args.entryId !== undefined && !holds(judged, "id")) {
    judged.id = args.entryId;
  }
  return judged;
}

/** The positions of the issues a read of `judged` says to withhold. */
async function withheldIssues(
  located: ReadonlyArray<{ steps: PathStep[] | null }>,
  judged: Record<string, unknown>,
  args: IssueJudgement
): Promise<Set<number>> {
  const redact = await readRedaction(args);
  const redacted = await redact(judged);
  const fns = getFieldFunctions(args.kind, args.slug);
  const hooksMayRedecide = holdsAfterReadHook(fns);
  const withheld = new Set<number>();
  for (const [index, { steps }] of located.entries()) {
    if (!steps || steps.length === 0) continue;
    if (
      (hooksMayRedecide && ruledAlong(fns, steps)) ||
      (await removedByRead(steps, judged, redacted, redact))
    ) {
      withheld.add(index);
    }
  }
  return withheld;
}

/**
 * Whether a read removes the field `steps` names. An issue on a field the
 * document leaves out is judged with that field held, on a copy of its own:
 * held beside the others, one placeholder could change how a rule reading it
 * decides another field.
 */
async function removedByRead(
  steps: PathStep[],
  judged: Record<string, unknown>,
  redacted: Record<string, unknown>,
  redact: (
    document: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
): Promise<boolean> {
  const held = structuredClone(judged);
  return holdIssuePath(held, steps)
    ? removedAlong(held, await redact(held), steps)
    : removedAlong(judged, redacted, steps);
}

/**
 * The read redaction of a document for this reader: a copy of it with every
 * field they may not read removed, as a read of it removes them.
 */
async function readRedaction(
  args: IssueJudgement
): Promise<
  (document: Record<string, unknown>) => Promise<Record<string, unknown>>
> {
  const { user, authenticatedScope } = args.reader;
  const grants =
    args.reader.grants ??
    callerAccessGrants(user, authenticatedScope, args.executor);
  const fieldGroupPass = await liveFieldGroupReadPass(
    args.fields,
    args.fieldGroups
  );
  const passwordReach = await fieldGroupReach(args);
  return async document => {
    const redacted = structuredClone(document);
    await applyFieldReadAccess({
      kind: args.kind,
      slug: args.slug,
      entry: redacted,
      user,
      authenticatedScope,
      grants,
    });
    await fieldGroupPass?.(redacted, { user, authenticatedScope, grants });
    // A read never shows a password, whatever its rules say.
    stripPasswordFieldValues(redacted, args.fields, passwordReach);
    return redacted;
  };
}

/** Where the password strip follows the field groups the document holds. */
async function fieldGroupReach(args: {
  fields: readonly FieldConfig[];
  fieldGroups?: FieldGroupFieldsSource;
  executor?: unknown;
}): Promise<Parameters<typeof stripPasswordFieldValues>[2]> {
  const source = args.fieldGroups;
  const fieldsOf = source
    ? await resolveComponentFieldMap([...args.fields], slug =>
        source.getComponentFields(slug, args.executor)
      )
    : new Map<string, FieldConfig[]>();
  return { fieldsOf: slug => fieldsOf.get(slug), direct: true };
}

/** Whether a field of the entity, at any depth, has an `afterRead` hook. */
function holdsAfterReadHook(
  fns: Record<string, FieldFunctions> | undefined
): boolean {
  return Object.values(fns ?? {}).some(
    field =>
      (field.hooks?.afterRead?.length ?? 0) > 0 ||
      holdsAfterReadHook(field.fields)
  );
}

/** Whether a field on the way down `steps` has a read rule of its own. */
function ruledAlong(
  fns: Record<string, FieldFunctions> | undefined,
  steps: PathStep[]
): boolean {
  let level = fns;
  for (const step of steps) {
    if (typeof step === "number") continue;
    const field = level?.[step];
    if (!field) return false;
    if (field.access?.read) return true;
    level = field.fields;
  }
  return false;
}

function collapse(
  located: Array<{ issue: ValidationIssue; steps: PathStep[] | null }>,
  withheld: (steps: PathStep[], index: number) => boolean,
  args: { kind: ReadKind; slug: string }
): ValidationIssue[] {
  const told: ValidationIssue[] = [];
  const kept: ValidationIssue[] = [];
  for (const [index, { issue, steps }] of located.entries()) {
    // An issue on the document as a whole names no field; one whose path
    // cannot be read is withheld, as it may name one.
    if (steps === null || (steps.length > 0 && withheld(steps, index))) {
      if (kept.length === 0) told.push(UNREADABLE_FIELD_ISSUE);
      kept.push(issue);
    } else {
      told.push(issue);
    }
  }
  if (kept.length > 0) {
    consoleLogger.info(
      "A validation refusal withheld issues on fields its caller may not read",
      {
        kind: args.kind,
        slug: args.slug,
        withheld: kept.map(({ path, code }) => ({ path, code })),
      }
    );
  }
  return told;
}
