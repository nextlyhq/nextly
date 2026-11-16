/**
 * Visibility conditions: whether a block is served, decided by the fields of
 * the entry a page shows or of the list item a block is drawn for.
 *
 * A node stores its conditions as an OR of AND groups of `{field, op, value}`.
 * This module is the one reading of them: the operator vocabulary, the
 * registry that says when each operator and source is decided, the judgement
 * of one condition against a source's fields, and the evaluator. The
 * validator refuses at save what the evaluator would fail on, and the
 * renderer asks the evaluator, so an author is never told a condition is
 * fine that the page then hides.
 *
 * Everything the evaluator cannot answer with certainty is HIDDEN and
 * reported: content missing from a page is visible and reportable, while
 * content shown to the wrong reader cannot be taken back. That includes a
 * field the public may not read: whether a block shows would otherwise
 * reveal the field's value, so a condition reads only the fields its source
 * names as public, whatever values it is handed.
 *
 * @module visibility-conditions
 */
import { isEmptyBoundValue, type BindingFieldShape } from "./binding-rules";
import type {
  BlockDocument,
  BlockNode,
  Condition,
  NodeVisibility,
} from "./document";
import { withHeldSeverity } from "./held-findings";
import { describeValue, pointer } from "./issue-text";
import {
  COLLECTION_LIST_TYPE,
  isListDay,
  isListFieldName,
  LIST_ENTRY_SLOT,
  listDayAfter,
  listFieldKind,
  readListQuery,
  type ListFieldKind,
  type ListFields,
  type ListFieldSource,
} from "./list-query";
import type { NamedQuerySource } from "./named-query";
import { isPlainRecord } from "./plain-record";
import { conditionGatesOf, isConditionGated } from "./visibility";

/**
 * The operators a condition may use, spelled as a list's filter spells them
 * where the two share a meaning, so one vocabulary filters a list and shows a
 * block. Closed: a stored operator outside it fails closed.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_OPS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
  "exists",
  "not_exists",
  "is_true",
  "is_false",
] as const;

/**
 * One of {@link CONDITION_OPS}.
 *
 * @experimental Settles with the editor's condition controls.
 */
export type ConditionOp = (typeof CONDITION_OPS)[number];

/**
 * The older spellings conditions were stored with before they were
 * evaluated, each read as the one operator it can only have meant. Only the
 * unambiguous ones: `gte` is not here, since whether "on or after a day"
 * includes the day is the question a spelling has to settle, not guess.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_OP_ALIASES: Readonly<Record<string, ConditionOp>> =
  Object.freeze({
    eq: "equals",
    ne: "not_equals",
    neq: "not_equals",
    gt: "greater_than",
    lt: "less_than",
  });

function isConditionOp(op: string): op is ConditionOp {
  return (CONDITION_OPS as readonly string[]).includes(op);
}

/**
 * The operator a stored spelling names, an older alias included, or
 * `undefined` for one no condition knows.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionOp(op: unknown): ConditionOp | undefined {
  if (typeof op !== "string") return undefined;
  if (isConditionOp(op)) return op;
  // An own key only, so `toString` or `__proto__` is not read as an alias.
  return Object.hasOwn(CONDITION_OP_ALIASES, op)
    ? CONDITION_OP_ALIASES[op]
    : undefined;
}

/**
 * When a condition is decided: when the page is generated (`static`), also at
 * a known time (`time-bounded`), or on every visit (`request`).
 *
 * @experimental Settles with the editor's condition controls.
 */
export type ConditionRenderClass = "static" | "time-bounded" | "request";

/**
 * Whose fields a condition reads: the entry the page shows, or the item of
 * the list the block is drawn inside.
 *
 * @experimental Settles with the editor's condition controls.
 */
export type ConditionSource = "entry" | "item";

/**
 * The render class of every operator and source. A page is generated ahead
 * of its visits, so only a `static` condition can be decided for it; a later
 * class must make the page that uses it visibly dynamic, never silently.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionRegistry {
  readonly ops: Readonly<Record<ConditionOp, ConditionRenderClass>>;
  readonly sources: Readonly<Record<ConditionSource, ConditionRenderClass>>;
}

/**
 * The registry this release ships: every operator and source `static`.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_REGISTRY: ConditionRegistry = Object.freeze({
  ops: Object.freeze({
    equals: "static",
    not_equals: "static",
    contains: "static",
    not_contains: "static",
    greater_than: "static",
    less_than: "static",
    exists: "static",
    not_exists: "static",
    is_true: "static",
    is_false: "static",
  }),
  sources: Object.freeze({ entry: "static", item: "static" }),
});

/**
 * The kinds of field a condition judges, a list's filter kinds plus `other`:
 * a field holding several values, rich text, media, a time of day, or any
 * value that is not one scalar, which a condition can only ask is set.
 *
 * @experimental Settles with the editor's condition controls.
 */
export type ConditionFieldKind = ListFieldKind | "other";

/**
 * A field's kind as a condition judges it, read from the list filter's kinds
 * so a field a list compares one way is not compared another way here.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionFieldKind(
  shape: BindingFieldShape
): ConditionFieldKind {
  return listFieldKind(shape) ?? "other";
}

/**
 * The operators a condition on a field of each kind may use. An order only
 * on a number or a date, contains only on text, and no "equals" on a date
 * until a day can be compared whatever time the field holds, as for lists.
 * The one table: the save refuses any other, and an editor offers these.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_KIND_OPS: Readonly<
  Record<ConditionFieldKind, readonly ConditionOp[]>
> = Object.freeze({
  text: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "exists",
    "not_exists",
  ],
  number: [
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "exists",
    "not_exists",
  ],
  date: ["greater_than", "less_than", "exists", "not_exists"],
  choice: ["equals", "not_equals", "exists", "not_exists"],
  boolean: ["is_true", "is_false", "equals", "not_equals"],
  entry: ["equals", "not_equals", "exists", "not_exists"],
  other: ["exists", "not_exists"],
});

/**
 * How many conditions one block may hold across its groups: what an author
 * can read, and a bound on the work one block asks of every render.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_MAX = 20;

/**
 * Every condition issue code, each with a one-line description.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_ISSUE_CODES: {
  readonly [Code in ConditionIssueCode]: string;
} = {
  "condition-malformed":
    "A block's conditions are not an OR-array of AND-arrays of {field, op, value?} naming one field each.",
  "condition-too-many": "A block holds more conditions than one block may.",
  "condition-op-unknown":
    "A condition uses an operator conditions do not have.",
  "condition-not-static":
    "A condition uses an operator or a source decided per visit, which a generated page cannot be.",
  "condition-field-unknown":
    "A condition checks a field its entry or item does not have.",
  "condition-field-protected":
    "A condition checks a field visitors may not see, so whether its block shows would reveal it.",
  "condition-unsuited":
    "A condition compares a field with an operator or a value its kind does not take.",
  "condition-source-unavailable":
    "A condition checks an entry or a list item the page does not have.",
  "condition-value-unreadable":
    "A condition's field holds a value of another type than the field declares.",
};

/**
 * A stable condition issue code.
 *
 * @experimental Settles with the editor's condition controls.
 */
export type ConditionIssueCode =
  | "condition-malformed"
  | "condition-too-many"
  | "condition-op-unknown"
  | "condition-not-static"
  | "condition-field-unknown"
  | "condition-field-protected"
  | "condition-unsuited"
  | "condition-source-unavailable"
  | "condition-value-unreadable";

/**
 * One block whose conditions could not be checked, and why. It travels the
 * binding issues' channel, marked by its `kind`, and like them carries where
 * the problem is and never the value the source holds: a report is read by
 * authors and written to logs.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionIssue {
  readonly kind: "condition";
  /** The node the conditions are on. */
  readonly nodeId: string;
  readonly code: ConditionIssueCode;
  /** A sentence an author can act on. */
  readonly message: string;
  /** The condition, as a pointer from the node: `/visibility/conditions/0/1`. */
  readonly path: string;
}

/**
 * The record a condition is checked against: its fields as the public sees
 * them, and its values as the public reads them from the published entry.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionSubject {
  readonly fields: ListFields;
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * The instant a day starts, for the field compared: a site starts its days
 * in its own zone, and a field holding a calendar day is stored as that day.
 */
export type ConditionDayStart = (
  day: string,
  field: BindingFieldShape
) => number;

/**
 * What {@link evaluateConditions} reads.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionInput {
  /** The item when the block is drawn inside a list, else the entry. */
  readonly source: ConditionSource;
  /** Absent when the page has no such record, which fails closed. */
  readonly subject?: ConditionSubject;
  /** Defaults to midnight UTC. */
  readonly dayStart?: ConditionDayStart;
  readonly registry?: ConditionRegistry;
}

/**
 * Whether a block is served, and what could not be checked.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionEvaluation {
  readonly shown: boolean;
  readonly issues: readonly ConditionIssue[];
}

/** One stored condition, read: the operator it names, and where it is. */
interface StoredCondition {
  readonly field: string;
  readonly op: unknown;
  readonly value: unknown;
  readonly path: string;
  /** "Condition 2", or "Condition 2 of group 1" when there are groups. */
  readonly label: string;
}

/** A condition that passed every check, ready to hold or not. */
interface CheckedCondition {
  readonly field: BindingFieldShape;
  readonly kind: ConditionFieldKind;
  readonly op: ConditionOp;
  readonly value: unknown;
  readonly label: string;
  readonly path: string;
}

/** Why one condition cannot be checked. */
interface ConditionProblem {
  readonly code: ConditionIssueCode;
  readonly message: string;
  readonly path: string;
}

const CONDITIONS_PATH = "/visibility/conditions";

/** Where a condition sits: its group, its place in it, and how many groups. */
interface ConditionPlace {
  readonly group: number;
  readonly index: number;
  readonly groups: number;
}

/** One stored condition, when it names one field and an operator. */
function readCondition(
  raw: unknown,
  place: ConditionPlace
): StoredCondition | undefined {
  if (!isPlainRecord(raw) || !isListFieldName(raw.field)) return undefined;
  if (typeof raw.op !== "string") return undefined;
  const number = String(place.index + 1);
  return {
    field: raw.field,
    op: raw.op,
    value: raw.value,
    path: pointer(pointer(CONDITIONS_PATH, place.group), place.index),
    label:
      place.groups > 1
        ? `Condition ${number} of group ${String(place.group + 1)}`
        : `Condition ${number}`,
  };
}

/** One stored AND group, when every condition in it reads. */
function readGroup(
  group: unknown,
  at: Omit<ConditionPlace, "index">
): StoredCondition[] | undefined {
  if (!Array.isArray(group)) return undefined;
  const read: StoredCondition[] = [];
  // Index loops, not `.every`, which skips holes: a sparse array's empty
  // slots are malformed, not passed over.
  for (let index = 0; index < group.length; index += 1) {
    const condition = readCondition(group[index], { ...at, index });
    if (condition === undefined) return undefined;
    read.push(condition);
  }
  return read;
}

/** The stored groups, when they are an OR of AND groups of conditions. */
function readGroups(
  conditions: unknown
): readonly (readonly StoredCondition[])[] | undefined {
  if (!Array.isArray(conditions)) return undefined;
  const groups: StoredCondition[][] = [];
  for (let group = 0; group < conditions.length; group += 1) {
    const read = readGroup(conditions[group], {
      group,
      groups: conditions.length,
    });
    if (read === undefined) return undefined;
    groups.push(read);
  }
  return groups;
}

/** The words for a field of each kind. */
const KIND_WORDS: Readonly<Record<ConditionFieldKind, string>> = {
  text: "a text field",
  number: "a number field",
  date: "a date field",
  choice: "a choice field",
  boolean: "a yes-or-no field",
  entry: "a related-entry field",
  other: "a field holding more than one value, or no single value",
};

/** Whether a value is one finite number. */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whether a value names one entry: its id. */
function isEntryId(value: unknown): value is string | number {
  return (typeof value === "string" && value !== "") || isNumber(value);
}

/** What a compared value must be, by kind, for `equals` and `not_equals`. */
const EQUALS_VALUE: Readonly<
  Record<
    ConditionFieldKind,
    (value: unknown, field: BindingFieldShape) => string | undefined
  >
> = {
  text: value => (typeof value === "string" ? undefined : "some text"),
  number: value => (isNumber(value) ? undefined : "a number"),
  date: () => "a day",
  choice: (value, field) =>
    typeof value === "string" &&
    (field.options === undefined ||
      field.options.length === 0 ||
      field.options.includes(value))
      ? undefined
      : "one of its options",
  boolean: value => (typeof value === "boolean" ? undefined : "yes or no"),
  entry: value => (isEntryId(value) ? undefined : "an entry's id"),
  other: () => "nothing",
};

/**
 * What the value of a condition must be for its operator on a field of its
 * kind, in words, or nothing when it fits. An operator the kind does not
 * take is judged before this.
 */
function valueNeed(
  op: ConditionOp,
  kind: ConditionFieldKind,
  value: unknown,
  field: BindingFieldShape
): string | undefined {
  return VALUE_NEEDS[op](value, kind, field);
}

/** What a value must be to search text for it. */
function searchNeed(value: unknown): string | undefined {
  return typeof value === "string" && value !== ""
    ? undefined
    : "the text to look for";
}

/** What a value must be to order a number or a day by it. */
function orderNeed(
  value: unknown,
  kind: ConditionFieldKind
): string | undefined {
  if (kind === "date") {
    return isListDay(value) ? undefined : "a day, written YYYY-MM-DD";
  }
  return isNumber(value) ? undefined : "a number";
}

/**
 * `exists`, `not_exists`, `is_true` and `is_false` take no value, so a stored
 * one is a condition that meant something else.
 */
function noValueNeed(value: unknown): string | undefined {
  return value === undefined ? undefined : "no value";
}

/** Each operator's value rule. A table, so a new operator must be given one. */
const VALUE_NEEDS: Readonly<
  Record<
    ConditionOp,
    (
      value: unknown,
      kind: ConditionFieldKind,
      field: BindingFieldShape
    ) => string | undefined
  >
> = {
  equals: (value, kind, field) => EQUALS_VALUE[kind](value, field),
  not_equals: (value, kind, field) => EQUALS_VALUE[kind](value, field),
  contains: searchNeed,
  not_contains: searchNeed,
  greater_than: orderNeed,
  less_than: orderNeed,
  exists: noValueNeed,
  not_exists: noValueNeed,
  is_true: noValueNeed,
  is_false: noValueNeed,
};

/** The operator a condition names, or why it names none this page can use. */
function judgeOp(
  stored: StoredCondition,
  registry: ConditionRegistry
): ConditionOp | ConditionProblem {
  const op = conditionOp(stored.op);
  if (op === undefined) {
    return {
      code: "condition-op-unknown",
      path: stored.path,
      message: `${stored.label} uses "${describeValue(stored.op)}", which isn't an operator conditions have, so the block is left out of the page. Choose another operator.`,
    };
  }
  if (registry.ops[op] !== "static") {
    return {
      code: "condition-not-static",
      path: stored.path,
      message: `${stored.label} uses "${op}", which is decided on each visit, and this page is built ahead of its visits, so the block is left out of the page.`,
    };
  }
  return op;
}

/** The public's shape of the field a condition checks, or why it has none. */
function judgeField(
  stored: StoredCondition,
  fields: ListFields
): BindingFieldShape | ConditionProblem {
  const shape = fields.readable.find(field => field.name === stored.field);
  if (shape !== undefined) return shape;
  if (fields.declared.has(stored.field)) {
    return {
      code: "condition-field-protected",
      path: stored.path,
      message: `${stored.label} checks "${stored.field}", which visitors can't see, so whether the block shows would reveal its value. Choose a field visitors can see.`,
    };
  }
  return {
    code: "condition-field-unknown",
    path: stored.path,
    message: `${stored.label} checks "${stored.field}", which ${fields.label ?? "its source"} doesn't have. Choose another field.`,
  };
}

/** Whether a condition suits its field's kind, or why it does not. */
function judgeFit(
  stored: StoredCondition,
  op: ConditionOp,
  field: BindingFieldShape
): CheckedCondition | ConditionProblem {
  const kind = conditionFieldKind(field);
  const where = `${stored.label} compares "${field.name}", ${KIND_WORDS[kind]},`;
  if (!CONDITION_KIND_OPS[kind].includes(op)) {
    return {
      code: "condition-unsuited",
      path: stored.path,
      message: `${where} with "${op}", which it doesn't take. Choose another operator.`,
    };
  }
  const need = valueNeed(op, kind, stored.value, field);
  if (need !== undefined) {
    return {
      code: "condition-unsuited",
      path: stored.path,
      message: `${where} with ${describeValue(stored.value)}. Choose ${need}.`,
    };
  }
  return {
    field,
    kind,
    op,
    value: stored.value,
    label: stored.label,
    path: stored.path,
  };
}

function isProblem(value: unknown): value is ConditionProblem {
  return isPlainRecord(value) && typeof value.code === "string";
}

/**
 * One condition judged: against the registry always, and against the
 * source's fields when they are known. Without fields, the operator alone is
 * judged, as a document is judged by its shape when no schema is given.
 */
function judgeCondition(
  stored: StoredCondition,
  fields: ListFields | undefined,
  registry: ConditionRegistry
): CheckedCondition | ConditionProblem | undefined {
  const op = judgeOp(stored, registry);
  if (isProblem(op)) return op;
  if (fields === undefined) return undefined;
  const field = judgeField(stored, fields);
  if (isProblem(field)) return field;
  return judgeFit(stored, op, field);
}

/** The id a related entry's value names, populated or not. */
function entryIdOf(value: unknown): string | number | undefined {
  if (isEntryId(value)) return value;
  return isPlainRecord(value) && isEntryId(value.id) ? value.id : undefined;
}

/** The instant a stored date holds, or `undefined` when it holds none. */
function instantOf(value: unknown): number | undefined {
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  return Number.isNaN(time) ? undefined : time;
}

const UTC_DAY_START: ConditionDayStart = day => Date.parse(`${day}T00:00:00Z`);

/** What a condition found: it holds or not, or its value could not be read. */
type Holds = boolean | "unreadable";

/** An order on a number or a day, read against an empty value as not held. */
function holdsOrder(
  condition: CheckedCondition,
  value: unknown,
  dayStart: ConditionDayStart
): Holds {
  const greater = condition.op === "greater_than";
  if (condition.kind === "date") {
    const time = instantOf(value);
    if (time === undefined) return "unreadable";
    const day = String(condition.value);
    // After a day is from the start of the next, before it is before its
    // start, so a value at any time on the day falls where an author means.
    return greater
      ? time >= dayStart(listDayAfter(day), condition.field)
      : time < dayStart(day, condition.field);
  }
  if (!isNumber(value)) return "unreadable";
  const bound = Number(condition.value);
  return greater ? value > bound : value < bound;
}

/** Whether two values are the same, by the field's kind. */
function sameValue(condition: CheckedCondition, value: unknown): Holds {
  switch (condition.kind) {
    case "entry": {
      const id = entryIdOf(value);
      return id === undefined
        ? "unreadable"
        : String(id) === String(condition.value);
    }
    case "boolean":
      if (typeof value !== "boolean") return "unreadable";
      return value === condition.value;
    case "number":
      return isNumber(value) ? value === condition.value : "unreadable";
    default:
      return typeof value === "string"
        ? value === condition.value
        : "unreadable";
  }
}

/** Whether a text value holds the condition's text, ignoring case. */
function containsText(condition: CheckedCondition, value: unknown): Holds {
  if (typeof value !== "string") return "unreadable";
  return value.toLowerCase().includes(String(condition.value).toLowerCase());
}

/** Negates a found answer, leaving an unreadable value unreadable. */
function not(found: Holds): Holds {
  return found === "unreadable" ? found : !found;
}

/**
 * Whether one condition holds for a value. An empty value holds nothing
 * positive: it does not equal, contain or order, and it is not set; so the
 * negations hold on it.
 */
function holds(
  condition: CheckedCondition,
  value: unknown,
  dayStart: ConditionDayStart
): Holds {
  const rule = OPERATORS[condition.op];
  return isEmptyBoundValue(value)
    ? rule.whenEmpty
    : rule.test(condition, value, dayStart);
}

/**
 * What each operator answers on an empty value, and how it tests a set one.
 * A table, so an operator added to the vocabulary must be given both.
 */
const OPERATORS: Readonly<
  Record<
    ConditionOp,
    {
      readonly whenEmpty: boolean;
      readonly test: (
        condition: CheckedCondition,
        value: unknown,
        dayStart: ConditionDayStart
      ) => Holds;
    }
  >
> = {
  exists: { whenEmpty: false, test: () => true },
  not_exists: { whenEmpty: true, test: () => false },
  is_true: {
    whenEmpty: false,
    test: (condition, value) => sameValue({ ...condition, value: true }, value),
  },
  is_false: {
    whenEmpty: true,
    test: (condition, value) =>
      sameValue({ ...condition, value: false }, value),
  },
  equals: { whenEmpty: false, test: sameValue },
  not_equals: {
    whenEmpty: true,
    test: (condition, value) => not(sameValue(condition, value)),
  },
  contains: { whenEmpty: false, test: containsText },
  not_contains: {
    whenEmpty: true,
    test: (condition, value) => not(containsText(condition, value)),
  },
  greater_than: { whenEmpty: false, test: holdsOrder },
  less_than: { whenEmpty: false, test: holdsOrder },
};

/** The issue a problem is reported as. */
function issueOf(nodeId: string, problem: ConditionProblem): ConditionIssue {
  return { kind: "condition", nodeId, ...problem };
}

/** Why a node's groups cannot be checked as a whole, before any one is. */
function wholeProblem(
  groups: readonly (readonly StoredCondition[])[] | undefined,
  input: ConditionInput,
  registry: ConditionRegistry
): ConditionProblem | undefined {
  if (groups === undefined) return MALFORMED;
  return (
    countProblem(groups) ??
    sourceProblem(input.source, registry) ??
    (input.subject === undefined ? missingSource(input.source) : undefined)
  );
}

/** The problem of conditions that cannot be read as single-field groups. */
const MALFORMED: ConditionProblem = {
  code: "condition-malformed",
  path: CONDITIONS_PATH,
  message:
    "This block's conditions can't be read, so it is left out of the page. Each condition names one field of the entry or list item, such as \"title\", not a path.",
};

/**
 * The problems that belong to a node's conditions as a whole, before any one
 * is judged, asked alike by the evaluator and by the save, so the save
 * refuses exactly what the page would hide.
 */
function countProblem(
  groups: readonly (readonly StoredCondition[])[]
): ConditionProblem | undefined {
  const count = groups.reduce((sum, group) => sum + group.length, 0);
  return count > CONDITION_MAX
    ? {
        code: "condition-too-many",
        path: CONDITIONS_PATH,
        message: `This block has ${String(count)} conditions, and a block may have ${String(CONDITION_MAX)}, so it is left out of the page. Remove some.`,
      }
    : undefined;
}

/** The words for the record a source reads. */
function recordOf(source: ConditionSource): string {
  return source === "item" ? "list item" : "entry";
}

/** Why a source cannot be decided when the page is built, if it cannot. */
function sourceProblem(
  source: ConditionSource,
  registry: ConditionRegistry
): ConditionProblem | undefined {
  return registry.sources[source] === "static"
    ? undefined
    : {
        code: "condition-not-static",
        path: CONDITIONS_PATH,
        message: `This block's conditions check the ${recordOf(source)}, which is decided on each visit, so the block is left out of the page.`,
      };
}

/** The problem of conditions on a record the page does not have. */
function missingSource(source: ConditionSource): ConditionProblem {
  const record = recordOf(source);
  return {
    code: "condition-source-unavailable",
    path: CONDITIONS_PATH,
    message: `This block's conditions check the ${record}, and this page has no ${record} to check, so the block is left out.`,
  };
}

const HIDDEN_BY_DEFAULT: ConditionEvaluation = { shown: false, issues: [] };

/** Every condition checked, or the problems found on the way. */
function checkAll(
  groups: readonly (readonly StoredCondition[])[],
  fields: ListFields,
  registry: ConditionRegistry
): { checked: CheckedCondition[][]; problems: ConditionProblem[] } {
  const problems: ConditionProblem[] = [];
  const checked = groups.map(group =>
    group.flatMap(stored => {
      const judged = judgeCondition(stored, fields, registry);
      if (judged === undefined || isProblem(judged)) {
        if (judged !== undefined) problems.push(judged);
        return [];
      }
      return [judged];
    })
  );
  return { checked, problems };
}

/**
 * Whether a node is served for the entry or list item it is drawn with.
 *
 * Conditions that restrict nobody (none, or an empty group) show the node
 * without reading anything. Otherwise every condition is judged first, and
 * any one that cannot be checked hides the node, even when another group
 * would hold: an author's restriction this cannot read is still a
 * restriction. Only then do the groups decide, an OR of ANDs.
 *
 * Pure, and reads only the fields the subject names as public.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function evaluateConditions(
  node: Pick<BlockNode, "id" | "visibility">,
  input: ConditionInput
): ConditionEvaluation {
  if (!isConditionGated(node)) return { shown: true, issues: [] };
  const nodeId = typeof node.id === "string" ? node.id : "";
  // Every gate must hold: the block's own conditions and those of each
  // component placement it was expanded from, judged one set at a time so
  // none is multiplied into another.
  const issues: ConditionIssue[] = [];
  for (const gate of conditionGatesOf(node.visibility)) {
    const evaluation = evaluateGate(nodeId, gate, input);
    if (!evaluation.shown) return evaluation;
    issues.push(...evaluation.issues);
  }
  return { shown: true, issues };
}

/** One gate's envelope judged: its groups, an OR of ANDs, for the subject. */
function evaluateGate(
  nodeId: string,
  envelope: unknown,
  input: ConditionInput
): ConditionEvaluation {
  const registry = input.registry ?? CONDITION_REGISTRY;
  const groups = isPlainRecord(envelope)
    ? readGroups(envelope.conditions)
    : undefined;
  const whole = wholeProblem(groups, input, registry);
  if (
    whole !== undefined ||
    groups === undefined ||
    input.subject === undefined
  ) {
    return whole === undefined
      ? HIDDEN_BY_DEFAULT
      : { shown: false, issues: [issueOf(nodeId, whole)] };
  }
  const { checked, problems } = checkAll(
    groups,
    input.subject.fields,
    registry
  );
  if (problems.length > 0) {
    return {
      shown: false,
      issues: problems.map(problem => issueOf(nodeId, problem)),
    };
  }
  return decide(
    checked,
    input.subject,
    input.dayStart ?? UTC_DAY_START,
    nodeId
  );
}

/** The OR of ANDs over checked conditions; an unreadable value hides. */
function decide(
  groups: readonly (readonly CheckedCondition[])[],
  subject: ConditionSubject,
  dayStart: ConditionDayStart,
  nodeId: string
): ConditionEvaluation {
  const unreadable: ConditionIssue[] = [];
  let shown = false;
  for (const group of groups) {
    let all = true;
    for (const condition of group) {
      // An own key only: a field named like a prototype member is not read.
      const value = Object.hasOwn(subject.values, condition.field.name)
        ? subject.values[condition.field.name]
        : undefined;
      const found = holds(condition, value, dayStart);
      if (found === "unreadable") {
        unreadable.push(
          issueOf(nodeId, {
            code: "condition-value-unreadable",
            path: condition.path,
            message: `${condition.label} checks "${condition.field.name}", which holds a value of another type than the field declares, so the block is left out of the page.`,
          })
        );
      }
      if (found !== true) all = false;
    }
    if (all) shown = true;
  }
  return unreadable.length > 0
    ? { shown: false, issues: unreadable }
    : { shown, issues: [] };
}

/**
 * Stored conditions with every older operator spelling rewritten as the
 * operator it names, for a writer to store; everything else, an unknown
 * operator included, is kept as stored so it still fails closed and is
 * reported. A shape that cannot be read comes back as it came.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function canonicalConditions(conditions: unknown): {
  readonly conditions: unknown;
  readonly upgraded: number;
} {
  if (readGroups(conditions) === undefined || !Array.isArray(conditions)) {
    return { conditions, upgraded: 0 };
  }
  let upgraded = 0;
  const rewritten = conditions.map((group: unknown[]) =>
    group.map((condition: unknown) => {
      if (!isPlainRecord(condition) || typeof condition.op !== "string") {
        return condition;
      }
      const op = conditionOp(condition.op);
      if (op === undefined || op === condition.op) return condition;
      upgraded += 1;
      return { ...condition, op };
    })
  );
  return { conditions: rewritten, upgraded };
}

/**
 * What {@link conditionIssues} judges with, as a list's query is judged.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionJudgement {
  /** The schema; absent, conditions are judged by their operators only. */
  readonly fields?: ListFieldSource;
  /**
   * The collection of the entry the page shows, for a block outside a list.
   * `null` when the page is known to be no collection's entry (a Single's),
   * so a condition on its entry can never be checked and is refused; absent
   * when the page is not known, and such a condition is judged by its
   * operator alone.
   */
  readonly entryCollection?: string | null;
  /**
   * The document's stored forms. A problem one of them already holds, on the
   * same block, is a warning: a condition stored before a field was hidden
   * keeps failing closed on the page, but must not make the page unsavable
   * for a change nobody made to it.
   */
  readonly stored?: readonly BlockDocument[];
  /** How many nodes to visit at most, as the rest of validation is bounded. */
  readonly maxNodes?: number;
  readonly registry?: ConditionRegistry;
  /**
   * The site's named queries, for a block whose conditions read a row of a
   * list whose source is one: judged against the fields its rows declare,
   * or the public fields of the collection they are entries of. Absent,
   * such a condition is judged by its operator alone.
   */
  readonly namedQueries?: NamedQuerySource;
}

/** One finding, before its severity is decided. */
interface ConditionFinding {
  readonly path: string;
  readonly nodeId: string;
  readonly code: ConditionIssueCode;
  readonly message: string;
  /** What the problem is about, apart from where it sits or how it reads. */
  readonly identity: string;
}

/**
 * The codes only the schema or the page's host can decide, so a caller that
 * judges a document by its shape first, and against the schema after, can
 * tell the second judgement's own findings apart.
 *
 * @experimental Settles with the editor's condition controls.
 */
export const CONDITION_FIELD_CODES: ReadonlySet<string> =
  new Set<ConditionIssueCode>([
    "condition-field-unknown",
    "condition-field-protected",
    "condition-unsuited",
    "condition-source-unavailable",
  ]);

/**
 * Where a block's conditions read: its source, and that source's collection.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionScope {
  readonly source: ConditionSource;
  /** `null` when the page has no such record; `undefined` when not known. */
  readonly collection: string | null | undefined;
  /**
   * The named query whose rows the item is, for a block in the per-entry
   * slot of a list whose source is one: its rows' fields are what the
   * block's conditions read.
   */
  readonly query?: string;
}

/**
 * Whether stored conditions are well formed to the validator's older shape
 * check, an OR-array of AND-arrays of `{field, op}` with string members,
 * which reports every other shape as `invalid-visibility`.
 */
function looselyShaped(conditions: unknown): boolean {
  return (
    Array.isArray(conditions) &&
    // Array.from reads a hole as undefined, which `every` would skip.
    Array.from(conditions).every(
      group =>
        Array.isArray(group) &&
        Array.from(group).every(
          condition =>
            isPlainRecord(condition) &&
            typeof condition.field === "string" &&
            typeof condition.op === "string"
        )
    )
  );
}

/**
 * A stable text for a stored value, so the same condition stored again is
 * the same problem however its label or place reads.
 */
function valueIdentity(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return describeValue(value);
  }
}

/** Every problem of one node's conditions, judged at save. */
function nodeProblems(
  groups: readonly (readonly StoredCondition[])[],
  scope: ConditionScope,
  judgement: ConditionJudgement
): { problem: ConditionProblem; identity: string }[] {
  const registry = judgement.registry ?? CONDITION_REGISTRY;
  // The same whole-node checks the evaluator makes, so the save refuses what
  // the page would hide.
  const whole =
    countProblem(groups) ??
    sourceProblem(scope.source, registry) ??
    (scope.collection === null ? missingSource(scope.source) : undefined);
  if (whole !== undefined) return [{ problem: whole, identity: "" }];
  const fields = scopeFields(scope, judgement);
  return groups.flat().flatMap(stored => {
    const judged = judgeCondition(stored, fields, registry);
    if (judged === undefined || !isProblem(judged)) return [];
    // The operator as it reads, so an older spelling rewritten to its
    // canonical one is the same condition; an unknown one as stored.
    const op = conditionOp(stored.op) ?? String(stored.op);
    const identity = `${stored.field}\u0000${op}\u0000${valueIdentity(stored.value)}`;
    return [{ problem: judged, identity }];
  });
}

/**
 * The fields a scope's conditions read, where the judgement can say: its
 * collection's, or, for a named query's row, the fields the query's rows
 * declare, or those of the collection they are entries of. The same rows
 * the list's item bindings are checked against, so a condition and a
 * binding on one row agree on what it holds.
 */
function scopeFields(
  scope: ConditionScope,
  judgement: ConditionJudgement
): ListFields | undefined {
  if (typeof scope.collection === "string") {
    return judgement.fields?.fieldsOf(scope.collection);
  }
  if (scope.query === undefined) return undefined;
  const declaration = judgement.namedQueries?.declarationOf(scope.query);
  if (declaration === undefined) return undefined;
  const rows = declaration.rows;
  if ("collection" in rows) return judgement.fields?.fieldsOf(rows.collection);
  // A schema of its own: every field it declares is one a row carries, and
  // one a visitor reads, since the reader projected the row to it.
  return {
    label: declaration.label,
    declared: new Set(rows.fields.map(field => field.name)),
    readable: rows.fields,
  };
}

/** The findings about one gated node's conditions, judged at save. */
function nodeFindings(
  node: Readonly<Record<string, unknown>>,
  path: string,
  scope: ConditionScope,
  judgement: ConditionJudgement
): ConditionFinding[] {
  const envelope = node.visibility;
  const conditions = isPlainRecord(envelope) ? envelope.conditions : undefined;
  // A shape the older check refuses is reported there as invalid-visibility.
  if (!looselyShaped(conditions)) return [];
  const groups = readGroups(conditions);
  const found =
    groups === undefined
      ? [{ problem: MALFORMED, identity: "" }]
      : nodeProblems(groups, scope, judgement);
  const nodeId = typeof node.id === "string" ? node.id : "";
  return found.map(({ problem, identity }) => ({
    nodeId,
    code: problem.code,
    message: problem.message,
    path: `${path}${problem.path}`,
    identity,
  }));
}

/** One node on the walk's stack, with where its conditions read. */
interface ConditionVisit {
  readonly node: unknown;
  readonly path: string;
  readonly scope: ConditionScope;
}

/**
 * Where a child in `slot` of `node` reads. Only a list's per-entry slot is
 * drawn once per entry, so only it reads the list's item; its empty state,
 * like every other slot, reads what the list itself reads. The one rule, for
 * the save's judgement and the renderer's gating alike.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionScopeIn(
  node: { readonly type?: unknown; readonly props?: unknown },
  slot: string,
  scope: ConditionScope
): ConditionScope {
  if (node.type !== COLLECTION_LIST_TYPE || slot !== LIST_ENTRY_SLOT) {
    return scope;
  }
  const { query } = readListQuery(node.props);
  return {
    source: "item",
    collection: query.collection,
    // A custom source's rows are its query's, whatever collection they are
    // entries of, so the item is read by that query.
    ...(query.namedQuery === undefined ? {} : { query: query.namedQuery.name }),
  };
}

/** The children of a node's slots, last first, for a stack to visit in order. */
function childVisits(
  node: Readonly<Record<string, unknown>>,
  path: string,
  scope: ConditionScope
): ConditionVisit[] {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return [];
  const visits: ConditionVisit[] = [];
  for (const name of Object.keys(slots).reverse()) {
    const children = slots[name];
    if (!Array.isArray(children)) continue;
    const inner = conditionScopeIn(node, name, scope);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      visits.push({
        node: children[index],
        path: pointer(pointer(`${path}/slots`, name), index),
        scope: inner,
      });
    }
  }
  return visits;
}

/**
 * Every finding about the conditions in a forest, in document order. A block
 * in a list's per-entry slot reads the list's item, every other block the
 * page's entry. Iterative and bounded, reading only plain records.
 */
function walkConditionFindings(
  nodes: readonly unknown[],
  judgement: ConditionJudgement
): ConditionFinding[] {
  const findings: ConditionFinding[] = [];
  let left = judgement.maxNodes ?? Number.MAX_SAFE_INTEGER;
  const page: ConditionScope = {
    source: "entry",
    collection: judgement.entryCollection,
  };
  const stack: ConditionVisit[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    stack.push({
      node: nodes[index],
      path: pointer("/nodes", index),
      scope: page,
    });
  }
  for (
    let visit = stack.pop();
    visit !== undefined && left > 0;
    visit = stack.pop()
  ) {
    left -= 1;
    const { node, path, scope } = visit;
    if (!isPlainRecord(node)) continue;
    if (isConditionGated(node)) {
      findings.push(...nodeFindings(node, path, scope, judgement));
    }
    stack.push(...childVisits(node, path, scope));
  }
  return findings;
}

/**
 * The problems of every block's conditions in a document, as validation
 * issues: an operator nobody knows or one not decided when the page is
 * built always, and when the schema is given, a field the source does not
 * have, one the public may not read, and an operator or value its kind does
 * not take. Each is an error, except one a stored form already held on the
 * same block, which is a warning.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionIssues(
  nodes: readonly unknown[],
  judgement: ConditionJudgement = {}
): {
  readonly path: string;
  /** The block the issue is about, so an editor shows it on that block. */
  readonly nodeId: string;
  readonly code: ConditionIssueCode;
  readonly message: string;
  readonly severity: "error" | "warning";
}[] {
  return withHeldSeverity(
    walkConditionFindings(nodes, judgement),
    judgement.stored,
    forest => walkConditionFindings(forest, judgement)
  );
}

/**
 * A node's visibility with its conditions replaced: the groups given, or
 * none when they restrict nobody, by the rule that gates a node: `undefined`,
 * no groups, or a group with no conditions, which always holds and so lets
 * everyone through. Everything else the visibility holds, such as which
 * devices show the block, is kept. `undefined` when nothing is left
 * to store, so a block shown everywhere to everyone stores no visibility.
 * The one writer, for the editor and the API alike.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function withConditions(
  visibility: NodeVisibility | undefined,
  conditions: readonly (readonly Condition[])[] | undefined
): NodeVisibility | undefined {
  // A visibility nothing can read, a string or a list, is replaced whole:
  // none of it can be kept.
  const { conditions: _old, ...rest } = isPlainRecord(visibility)
    ? visibility
    : {};
  // Asked of the gate itself, so what is stored is what restricts.
  const restricts =
    conditions !== undefined &&
    isConditionGated({ visibility: { conditions } });
  const kept = !restricts
    ? rest
    : {
        ...rest,
        conditions: conditions.map(group => group.map(c => ({ ...c }))),
      };
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/**
 * What a forest's conditions read of the page's entry, so a route reads the
 * entry once for its bindings and its conditions alike.
 *
 * @experimental Settles with the editor's condition controls.
 */
export interface ConditionDemand {
  /** Whether any block's conditions restrict anybody, of any scope. */
  readonly any: boolean;
  /** The entry fields entry-scoped conditions check. */
  readonly entryFields: ReadonlySet<string>;
  /**
   * Whether an entry-scoped condition orders a value, which may compare days
   * and so needs the site's time zone. Derived from {@link orderedFields}.
   */
  readonly ordersValues: boolean;
  /**
   * The fields entry-scoped conditions order by. Only a date one compares
   * days, so a reader that knows the fields' shapes asks for the zone only
   * when one of these is a date. Always set by `conditionDemand`; optional
   * so a demand built by hand without it still type-checks, and read as
   * none when absent.
   */
  readonly orderedFields?: ReadonlySet<string>;
}

/** The fields one entry-scoped node's conditions read, and those they order by. */
function demandOf(
  node: Readonly<Record<string, unknown>>,
  fields: Set<string>,
  ordered: Set<string>
): void {
  // Every gate's fields: the block's own and those of the placements it was
  // expanded from, since each is judged against the same entry.
  const storedConditions = conditionGatesOf(node.visibility).flatMap(gate =>
    isPlainRecord(gate) ? (readGroups(gate.conditions)?.flat() ?? []) : []
  );
  for (const stored of storedConditions) {
    fields.add(stored.field);
    const op = conditionOp(stored.op);
    if (op === "greater_than" || op === "less_than") ordered.add(stored.field);
  }
}

/**
 * What the conditions in a forest read of the page's entry. Conditions a
 * list's item decides read the item, which a list already holds whole, so
 * they ask nothing of the entry. Iterative and bounded, reading only plain
 * records.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionDemand(
  nodes: readonly unknown[],
  maxNodes: number = Number.MAX_SAFE_INTEGER
): ConditionDemand {
  const entryFields = new Set<string>();
  const orderedFields = new Set<string>();
  let any = false;
  let left = maxNodes;
  const page: ConditionScope = { source: "entry", collection: undefined };
  const stack: ConditionVisit[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    stack.push({ node: nodes[index], path: "", scope: page });
  }
  for (
    let visit = stack.pop();
    visit !== undefined && left > 0;
    visit = stack.pop()
  ) {
    left -= 1;
    const { node, scope } = visit;
    if (!isPlainRecord(node)) continue;
    if (isConditionGated(node)) {
      any = true;
      if (scope.source === "entry") {
        demandOf(node, entryFields, orderedFields);
      }
    }
    stack.push(...childVisits(node, "", scope));
  }
  return {
    any,
    entryFields,
    ordersValues: orderedFields.size > 0,
    orderedFields,
  };
}
