/**
 * Named queries: a collection list's custom source.
 *
 * A developer registers a named query in code: a name stored on every list
 * that uses it, typed inputs an author sets on the list as literals, every
 * collection, Single and site setting it reads, the shape of the rows it
 * returns, and a `run` function. An author chooses it as a list's source and
 * fills its inputs; nothing an author types is ever a query.
 *
 * This module holds what is pure about them, so the validator, the renderer
 * and the editor share one reading: the declaration's types and its checks,
 * how a list's stored inputs are judged against it, the process registry the
 * page builder fills at boot, and every message an author or a developer is
 * shown about one. What `run` reads is decided by the renderer, which hands
 * it a reader limited to what it declares (`blocks-react`'s `named-read`).
 *
 * @module named-query
 */
import type { BindingFieldShape } from "./binding-rules";
import { isCalendarDay } from "./calendar-day";
import { isTopLevelFieldName } from "./field-name";
import { describeValue } from "./issue-text";
import { isPlainRecord } from "./plain-record";

/** The longest name a query may have. */
const NAMED_QUERY_NAME_MAX = 64;
/** The most inputs one query may declare, and one list may store. */
export const NAMED_QUERY_MAX_PARAMS = 12;
/** The longest text one input may hold, stored or typed. */
export const NAMED_QUERY_TEXT_MAX = 200;
/**
 * The most collections, Singles and site settings one query may declare.
 * Each becomes a tag on the query's cached result, and well under the 128
 * a cache entry keeps, with room for the page's own.
 */
const NAMED_QUERY_MAX_READS = 64;
/** The most choices one choice input may offer. */
const NAMED_QUERY_MAX_OPTIONS = 200;
/** The deepest a row schema's groups may nest. */
const NAMED_QUERY_MAX_ROW_DEPTH = 8;
/** How long a run may take when its query names no time of its own. */
export const NAMED_QUERY_DEFAULT_TIMEOUT_MS = 5000;
/** The longest a query may ask to run. */
export const NAMED_QUERY_MAX_TIMEOUT_MS = 30_000;
/** The longest a query's label and description may be. */
const NAMED_QUERY_LABEL_MAX = 60;
const NAMED_QUERY_DESCRIPTION_MAX = 120;

/**
 * A query's name: lowercase words of letters and digits, joined by hyphens,
 * in segments joined by dots (`events.upcoming`). Stored on every list that
 * uses it, so it is an id.
 */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** Whether a value is a name a query may be registered under. */
export function isNamedQueryName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= NAMED_QUERY_NAME_MAX &&
    NAME.test(value)
  );
}

/** Whether a value is a key an input may have: a top-level field name. */
export function isNamedQueryParamKey(value: unknown): value is string {
  return isTopLevelFieldName(value);
}

/** One literal a list stores for an input. */
export type NamedQueryParamValue = string | number | boolean;

/** One choice of a choice input. */
export interface NamedQueryChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * A text input.
 *
 * @experimental
 */
export interface TextParam {
  readonly type: "text";
  readonly label: string;
  readonly required?: boolean;
  readonly default?: string;
  /** At most {@link NAMED_QUERY_TEXT_MAX}. */
  readonly maxLength?: number;
  readonly placeholder?: string;
}

/**
 * A number input.
 *
 * @experimental
 */
export interface NumberParam {
  readonly type: "number";
  readonly label: string;
  readonly required?: boolean;
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  /** A whole number. */
  readonly integer?: boolean;
  /** What the number counts, shown beside it ("days"). */
  readonly unit?: string;
}

/**
 * A yes-or-no input. Never required: it always has a value, `false` unless
 * its default says otherwise.
 *
 * @experimental
 */
export interface BooleanParam {
  readonly type: "boolean";
  readonly label: string;
  readonly default?: boolean;
}

/**
 * One of a fixed set of values.
 *
 * @experimental
 */
export interface ChoiceParam {
  readonly type: "choice";
  readonly label: string;
  readonly options: readonly NamedQueryChoice[];
  readonly required?: boolean;
  readonly default?: string;
}

/**
 * A calendar day, stored as a date filter stores one, `YYYY-MM-DD`. A default
 * of `"today"` reaches run as the render's today.
 *
 * @experimental
 */
export interface DayParam {
  readonly type: "day";
  readonly label: string;
  readonly required?: boolean;
  readonly default?: "today" | `${number}-${number}-${number}`;
}

/**
 * An entry of one collection, stored as its id. The collection must be one
 * the query reads.
 *
 * @experimental
 */
export interface EntryParam {
  readonly type: "entry";
  readonly label: string;
  readonly collection: string;
  readonly required?: boolean;
}

/**
 * One typed input of a named query.
 *
 * @experimental
 */
export type NamedQueryParam =
  | TextParam
  | NumberParam
  | BooleanParam
  | ChoiceParam
  | DayParam
  | EntryParam;

/**
 * A named query's inputs, by key.
 *
 * @experimental
 */
export type NamedQueryParams = Readonly<Record<string, NamedQueryParam>>;

/** The kind of input each `type` names. */
export type NamedQueryParamType = NamedQueryParam["type"];

/** The value run receives for an input of type `T`. */
type ValueOf<T extends NamedQueryParam> = T extends NumberParam
  ? number
  : T extends BooleanParam
    ? boolean
    : T extends EntryParam
      ? string | number
      : T extends ChoiceParam
        ? T["options"][number]["value"]
        : string;

/** Whether run always receives a value for an input. */
type AlwaysSet<T> = T extends BooleanParam
  ? true
  : T extends { readonly required: true }
    ? true
    : T extends { readonly default: string | number }
      ? true
      : false;

/**
 * The values run receives for a query's inputs: present for a required
 * input, one with a default and a yes-or-no input, possibly absent otherwise.
 *
 * @experimental
 */
export type NamedQueryParamValues<P extends NamedQueryParams> = {
  readonly [K in keyof P as AlwaysSet<P[K]> extends true ? K : never]: ValueOf<
    P[K]
  >;
} & {
  readonly [K in keyof P as AlwaysSet<P[K]> extends true ? never : K]?: ValueOf<
    P[K]
  >;
};

/**
 * Building the six inputs, so a definition reads as a list of controls.
 *
 * @experimental
 */
export const param: {
  text<const O extends Omit<TextParam, "type">>(options: O): O & TextParam;
  number<const O extends Omit<NumberParam, "type">>(
    options: O
  ): O & NumberParam;
  boolean<const O extends Omit<BooleanParam, "type">>(
    options: O
  ): O & BooleanParam;
  choice<const O extends Omit<ChoiceParam, "type">>(
    options: O
  ): O & ChoiceParam;
  day<const O extends Omit<DayParam, "type">>(options: O): O & DayParam;
  entry<const O extends Omit<EntryParam, "type">>(options: O): O & EntryParam;
} = {
  text: options => ({ ...options, type: "text" }),
  number: options => ({ ...options, type: "number" }),
  boolean: options => ({ ...options, type: "boolean" }),
  choice: options => ({ ...options, type: "choice" }),
  day: options => ({ ...options, type: "day" }),
  entry: options => ({ ...options, type: "entry" }),
};

/**
 * What a query's rows are: the entries of a collection, keyed by their id,
 * or rows of a declared field schema, keyed by one of its text or number
 * fields. The editor's binding picker and the binding checks read a list's
 * items from this.
 *
 * @experimental
 */
export type NamedQueryRows =
  | { readonly collection: string }
  | { readonly fields: readonly BindingFieldShape[]; readonly key: string };

/** A filter row a named query's reader takes, spelled as the reader spells it. */
export interface NamedReadFilter {
  readonly field: string;
  readonly op:
    | "equals"
    | "not_equals"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in"
    | "not_in"
    | "exists";
  readonly value:
    | string
    | number
    | boolean
    | readonly (string | number | boolean)[];
}

/**
 * One read a named query asks of its reader: typed filter rows, sort keys
 * and a window, as a collection list's own read is. Never a raw query.
 *
 * @experimental
 */
export interface NamedReadQuery {
  readonly collection: string;
  readonly filters?: readonly NamedReadFilter[];
  /** One key or several, `-field` descending; the reader adds the id last. */
  readonly sort?: string | readonly string[];
  /** 1 to 100. */
  readonly limit?: number;
  readonly offset?: number;
  readonly page?: number;
  readonly locale?: string;
  /** The fields each row carries, besides its id. */
  readonly select?: readonly string[];
}

/**
 * The reader handed to run: published entries and public fields only, read
 * as an anonymous visitor, limited to what the query declares, and each read
 * counted against the page's allowance.
 *
 * @experimental
 */
export interface NamedQueryReader {
  find(query: NamedReadQuery): Promise<{
    items: Record<string, unknown>[];
    meta: { total: number };
  }>;
  count(
    query: Pick<NamedReadQuery, "collection" | "filters" | "locale">
  ): Promise<number>;
  findSingle(query: {
    readonly slug: string;
    readonly locale?: string;
    readonly select?: readonly string[];
  }): Promise<Record<string, unknown> | null>;
  siteSettings(): Promise<Readonly<Record<string, unknown>>>;
}

/**
 * What run is called with.
 *
 * @experimental
 */
export interface NamedQueryRunArgs<
  P extends NamedQueryParams = NamedQueryParams,
> {
  /** Judged against the declaration, defaults applied; an undeclared one is never passed. */
  readonly params: NamedQueryParamValues<P>;
  /** The list's number of items and entries to skip, applied after the query's own order. */
  readonly window: { readonly limit: number; readonly offset: number };
  readonly reader: NamedQueryReader;
  /** The page's language. */
  readonly locale?: string;
  /** Today in the site's time zone, `YYYY-MM-DD`, the same for the whole render. */
  readonly today: string;
  /** Aborted once the query's time is up. */
  readonly signal: AbortSignal;
}

/**
 * What run returns.
 *
 * @experimental
 */
export interface NamedQueryResult {
  /** In the query's order, the row key last, at most `window.limit` rows. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /** With `total: true`: how many rows match before the window, a whole number. */
  readonly total?: number;
}

/**
 * Everything a named query declares, without its run function: what the
 * editor, the validator and the API read, in the browser as on the server.
 *
 * @experimental
 */
export interface NamedQueryDeclaration<
  P extends NamedQueryParams = NamedQueryParams,
  R extends NamedQueryRows = NamedQueryRows,
> {
  /** Stored on every list that uses it, so never rename it. */
  readonly name: string;
  /** What authors see in the Source menu, at most 60 characters. */
  readonly label: string;
  /** One line for the menu and the Source hint, at most 120 characters. */
  readonly description?: string;
  /** Typed inputs, set on the list as literals; at most 12. */
  readonly params?: P;
  /** Everything run may read. Undeclared reads are refused; declared ones tag the page. */
  readonly reads: {
    readonly collections?: readonly string[];
    readonly singles?: readonly string[];
    readonly site?: boolean;
  };
  readonly rows: R;
  /** True when run returns how many rows match before the window. */
  readonly total?: boolean;
  /** Seconds a cached result may live, for a query that depends on the date. */
  readonly revalidate?: number;
  /** How long run may take before it is stopped: 5000 by default, at most 30000. */
  readonly timeoutMs?: number;
}

/**
 * A named query: its declaration, and the function that reads its rows.
 *
 * `run` is a method so a definition with typed inputs is still a definition
 * of any inputs where the registry holds it.
 *
 * @experimental
 */
export interface NamedQueryDefinition<
  P extends NamedQueryParams = NamedQueryParams,
  R extends NamedQueryRows = NamedQueryRows,
> extends NamedQueryDeclaration<P, R> {
  run(args: NamedQueryRunArgs<P>): Promise<NamedQueryResult>;
}

/**
 * Declare a named query. Returns it unchanged; its types are what it adds.
 *
 * Named queries run as your app's code. The reader keeps them to what visitors may read; it isn't a sandbox for untrusted code.
 *
 * @experimental
 */
export function defineNamedQuery<
  const P extends NamedQueryParams = Record<never, never>,
  const R extends NamedQueryRows = NamedQueryRows,
>(definition: NamedQueryDefinition<P, R>): NamedQueryDefinition<P, R> {
  return definition;
}

/** A declaration's `run`-free copy, so nothing that holds it can call it. */
export function namedQueryDeclaration(
  definition: NamedQueryDeclaration
): NamedQueryDeclaration {
  const {
    name,
    label,
    description,
    params,
    reads,
    rows,
    total,
    revalidate,
    timeoutMs,
  } = definition;
  return {
    name,
    label,
    ...(description === undefined ? {} : { description }),
    ...(params === undefined ? {} : { params }),
    reads,
    rows,
    ...(total === undefined ? {} : { total }),
    ...(revalidate === undefined ? {} : { revalidate }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/**
 * Where a list's named queries are looked up by name. `undefined` for a name
 * nothing is registered under.
 *
 * @experimental
 */
export interface NamedQuerySource {
  declarationOf(name: string): NamedQueryDeclaration | undefined;
}

/** How long a run may take, within the bounds. */
export function namedQueryTimeout(declaration: NamedQueryDeclaration): number {
  const asked = declaration.timeoutMs;
  return typeof asked === "number" &&
    Number.isFinite(asked) &&
    asked > 0 &&
    asked <= NAMED_QUERY_MAX_TIMEOUT_MS
    ? asked
    : NAMED_QUERY_DEFAULT_TIMEOUT_MS;
}

/** The inputs a declaration names, in its order. */
function paramsOf(
  declaration: NamedQueryDeclaration
): [string, NamedQueryParam][] {
  return Object.entries(declaration.params ?? {});
}

/** Whether an input needs a value an author must give: required, with no default. */
export function namedQueryParamNeedsInput(param: NamedQueryParam): boolean {
  return (
    param.type !== "boolean" &&
    param.required === true &&
    !("default" in param && param.default !== undefined)
  );
}

/** Whether any of a query's inputs needs a value an author must give. */
export function namedQueryNeedsInput(
  declaration: NamedQueryDeclaration
): boolean {
  return paramsOf(declaration).some(([, each]) =>
    namedQueryParamNeedsInput(each)
  );
}

/** A label as it sits mid-sentence: its first letter lowercased. */
function inSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Every sentence an author or developer reads about a named query: the
 * save's issues, the canvas's notes and the boot's errors. One place, so the
 * editor and the API say the same thing.
 *
 * @experimental
 */
export const NAMED_QUERY_TEXT: {
  readonly unknown: (name: string) => string;
  readonly missingChoose: (query: string, label: string) => string;
  readonly missingEnter: (query: string, label: string) => string;
  readonly missingAtRun: (query: string, label: string) => string;
  readonly paramUnknown: (query: string, key: string) => string;
  readonly readsHidden: (collection: string) => string;
  readonly rowsHidden: (query: string, collection: string) => string;
  readonly runFailed: (detail: string) => string;
  readonly threw: (query: string, ref: string) => string;
  readonly timeout: (query: string, seconds: number) => string;
  readonly undeclaredRead: (query: string, what: string) => string;
  readonly trustedRead: (query: string) => string;
  readonly budget: (query: string) => string;
  readonly badRows: (query: string) => string;
  readonly removed: (name: string) => string;
  readonly filtersSetBy: (query: string) => string;
  readonly counted: (matching: number, shown: number) => string;
  readonly uncounted: (query: string) => string;
  readonly nestedRelated: string;
} = {
  unknown: name =>
    `"${name}" isn't set up on this site any more, so visitors see the empty state. Choose another source.`,
  missingChoose: (query, label) =>
    `Choose a ${inSentence(label)}. ${query} needs one to run.`,
  missingEnter: (query, label) =>
    `Enter ${inSentence(label)}. ${query} needs it to run.`,
  missingAtRun: (query, label) =>
    `${query} needs a ${inSentence(label)}, which this list doesn't set.`,
  paramUnknown: (query, key) =>
    `${query} no longer takes "${key}". It will be left out.`,
  readsHidden: collection =>
    `It reads ${collection}, which visitors can't read, so a published list of it may show nothing.`,
  rowsHidden: (query, collection) =>
    `${query} lists entries of ${collection}, which visitors can't read, so this list can never show anything. Choose another source.`,
  runFailed: detail =>
    `This list couldn't load its entries, so visitors see its empty state. ${detail}`,
  threw: (query, ref) =>
    `${query} stopped with an error. A developer can find it in the server log as ${ref}.`,
  timeout: (query, seconds) =>
    `${query} took longer than ${String(seconds)} seconds, so it was stopped.`,
  undeclaredRead: (query, what) =>
    `${query} read ${what}, which it doesn't declare, so it was stopped. A developer can add it to the query's reads.`,
  trustedRead: query =>
    `${query} tried to read with more access than a visitor has, so it was stopped.`,
  budget: query =>
    `This page has used up the reads it may make, so ${query} wasn't run.`,
  badRows: query =>
    `${query} gave two rows the same key, or a row with none, so its rows can't be shown.`,
  removed: name => `Its source, "${name}", isn't set up on this site any more.`,
  filtersSetBy: query =>
    `Set by ${query}: it decides which entries show, and their order.`,
  counted: (matching, shown) =>
    `${String(matching)} match, so ${String(shown)} show.`,
  uncounted: query =>
    `${query} doesn't count its entries, so this list can't be split into pages. Turn this off, or ask a developer to make it return a total.`,
  nestedRelated:
    "The list around this one shows a custom source's rows, which have no related entries. Choose a collection.",
};

/** One problem with a list's stored inputs, judged against a declaration. */
export interface NamedParamProblem {
  /** The input's key. */
  readonly param: string;
  /** No value for an input that needs one, or one it does not take. */
  readonly kind: "missing" | "invalid";
  readonly message: string;
}

/** A list's stored inputs, judged and filled for run. */
export interface NamedParamJudgement {
  /** The values run receives: defaults applied, undeclared ones left out. */
  readonly values: Readonly<Record<string, NamedQueryParamValue>>;
  readonly problems: readonly NamedParamProblem[];
  /** Stored keys the query no longer declares, which are left out. */
  readonly unknown: readonly string[];
}

/** The words for a number outside what an input takes. */
function numberNeed(param: NumberParam): string {
  const whole = param.integer === true ? "a whole number" : "a number";
  const { min, max } = param;
  if (min !== undefined && max !== undefined) {
    return `Enter ${whole} from ${String(min)} to ${String(max)}.`;
  }
  if (min !== undefined) return `Enter ${whole} from ${String(min)} up.`;
  if (max !== undefined) return `Enter ${whole} up to ${String(max)}.`;
  return `Enter ${whole}.`;
}

/** Why text does not fit a text input. */
function textProblem(param: TextParam, value: unknown): string | undefined {
  const max = Math.min(
    param.maxLength ?? NAMED_QUERY_TEXT_MAX,
    NAMED_QUERY_TEXT_MAX
  );
  if (typeof value !== "string") return "Enter text.";
  return value.length > max
    ? `Enter at most ${String(max)} characters.`
    : undefined;
}

/** Why a value does not fit a number input. */
function numberProblem(param: NumberParam, value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return numberNeed(param);
  }
  const whole = param.integer !== true || Number.isSafeInteger(value);
  const above = param.min === undefined || value >= param.min;
  const below = param.max === undefined || value <= param.max;
  return whole && above && below ? undefined : numberNeed(param);
}

/** Why a value is not an entry's id. */
function entryProblem(value: unknown): string | undefined {
  const text =
    typeof value === "string" &&
    value !== "" &&
    value.length <= NAMED_QUERY_TEXT_MAX;
  const id = typeof value === "number" && Number.isSafeInteger(value);
  return text || id ? undefined : "Choose an entry by its id.";
}

/**
 * What each input type takes, as the reason a value does not fit it. A
 * table, so an input type added to the union fails to compile here until it
 * is given one.
 */
const VALUE_RULES: {
  readonly [T in NamedQueryParamType]: (
    param: Extract<NamedQueryParam, { readonly type: T }>,
    value: unknown,
    query: string
  ) => string | undefined;
} = {
  text: textProblem,
  number: numberProblem,
  boolean: (_param, value) =>
    typeof value === "boolean" ? undefined : "Choose yes or no.",
  choice: (param, value, query) =>
    typeof value === "string" &&
    param.options.some(option => option.value === value)
      ? undefined
      : `Choose one of ${query}'s ${inSentence(param.label)} options.`,
  day: (_param, value) =>
    isCalendarDay(value) ? undefined : "Enter a day written YYYY-MM-DD.",
  entry: (_param, value) => entryProblem(value),
};

/** Why a value does not fit an input, or nothing when it does. */
function valueProblem(
  param: NamedQueryParam,
  value: unknown,
  query: string
): string | undefined {
  const rule = VALUE_RULES[param.type] as (
    param: NamedQueryParam,
    value: unknown,
    query: string
  ) => string | undefined;
  return rule(param, value, query);
}

/** An input's default, when it has one; `today` resolves a day's "today". */
function defaultOf(
  param: NamedQueryParam,
  today: string | undefined
): NamedQueryParamValue | undefined {
  switch (param.type) {
    case "boolean":
      return param.default ?? false;
    case "entry":
      return undefined;
    case "day":
      return param.default === "today" ? today : param.default;
    default:
      return param.default;
  }
}

/** The words for an input that needs a value and has none. */
function missingWords(
  param: NamedQueryParam,
  query: string,
  atRun: boolean
): string {
  if (atRun) return NAMED_QUERY_TEXT.missingAtRun(query, param.label);
  return param.type === "text" || param.type === "number"
    ? NAMED_QUERY_TEXT.missingEnter(query, param.label)
    : NAMED_QUERY_TEXT.missingChoose(query, param.label);
}

/** One declared input judged: its value for run, or why it has none. */
function judgeOne(
  key: string,
  each: NamedQueryParam,
  stored: Readonly<Record<string, unknown>> | undefined,
  context: {
    readonly query: string;
    readonly today?: string;
    readonly atRun: boolean;
  }
): {
  readonly value?: NamedQueryParamValue;
  readonly problem?: NamedParamProblem;
} {
  const value =
    stored !== undefined && Object.hasOwn(stored, key)
      ? stored[key]
      : undefined;
  if (value !== undefined) {
    const wrong = valueProblem(each, value, context.query);
    return wrong === undefined
      ? { value: value as NamedQueryParamValue }
      : { problem: { param: key, kind: "invalid", message: wrong } };
  }
  const fallback = defaultOf(each, context.today);
  if (fallback !== undefined) return { value: fallback };
  // A day defaulting to "today" has a value whenever it is run, so the save,
  // which has no today of its own, counts it as set.
  const today = each.type === "day" && each.default === "today";
  if (each.type === "boolean" || each.required !== true || today) return {};
  return {
    problem: {
      param: key,
      kind: "missing",
      message: missingWords(each, context.query, context.atRun),
    },
  };
}

/**
 * A list's stored inputs judged against its query: each declared input's
 * value (the stored one, else its default), each one that is missing or does
 * not fit, and each stored key the query no longer declares. The one
 * judgement the save, the editor and the run share, so a value the save
 * refuses never reaches developer code.
 *
 * `today` is the render's day, for a day input defaulting to "today"; the
 * save judges without one, and such an input then counts as set.
 */
export function judgeNamedParams(
  declaration: NamedQueryDeclaration,
  stored: Readonly<Record<string, unknown>> | undefined,
  options: { readonly today?: string; readonly atRun?: boolean } = {}
): NamedParamJudgement {
  const values: Record<string, NamedQueryParamValue> = {};
  const problems: NamedParamProblem[] = [];
  const declared = paramsOf(declaration);
  const context = {
    query: declaration.label,
    ...(options.today === undefined ? {} : { today: options.today }),
    atRun: options.atRun === true,
  };
  for (const [key, each] of declared) {
    const judged = judgeOne(key, each, stored, context);
    if (judged.value !== undefined) values[key] = judged.value;
    if (judged.problem !== undefined) problems.push(judged.problem);
  }
  const known = new Set(declared.map(([key]) => key));
  const unknown =
    stored === undefined
      ? []
      : Object.keys(stored).filter(key => !known.has(key));
  return { values, problems, unknown };
}

/** The collections and Singles that exist, for the boot's checks. */
export interface NamedQueryKnown {
  readonly collection: (slug: string) => boolean;
  readonly single: (slug: string) => boolean;
}

/** Whether a value is a list of non-empty strings, with no holes. */
function isSlugList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    // `Array.from` reads every slot, so a hole is judged as undefined
    // rather than skipped, as `every` alone would skip it.
    Array.from(value as unknown[]).every(
      each => typeof each === "string" && each !== ""
    )
  );
}

/** Why a text input's bound is out of range. */
function textShapeProblem(param: TextParam, at: string): string | undefined {
  const max = param.maxLength;
  return max === undefined ||
    (Number.isSafeInteger(max) && max >= 1 && max <= NAMED_QUERY_TEXT_MAX)
    ? undefined
    : `${at}'s maxLength is not a whole number from 1 to ${String(NAMED_QUERY_TEXT_MAX)}`;
}

/**
 * Why a number input's bounds are not ones its values can be judged by: each
 * present bound a finite number (a safe whole number for a whole-number
 * input), and the least no greater than the most. A bound read from an unset
 * variable is `NaN`, which every comparison fails.
 */
function numberShapeProblem(
  param: NumberParam,
  at: string
): string | undefined {
  const whole = param.integer === true;
  for (const [name, bound] of [
    ["min", param.min],
    ["max", param.max],
  ] as const) {
    if (bound === undefined) continue;
    const fits = whole
      ? Number.isSafeInteger(bound)
      : typeof bound === "number" && Number.isFinite(bound);
    if (!fits) {
      return `${at}'s ${name} is ${describeValue(bound)}, not a ${whole ? "safe whole number" : "finite number"}`;
    }
  }
  return param.min !== undefined &&
    param.max !== undefined &&
    param.min > param.max
    ? `${at}'s min is above its max`
    : undefined;
}

/** Why a choice input's options cannot be drawn. */
function choiceShapeProblem(
  param: ChoiceParam,
  at: string
): string | undefined {
  const options: unknown = param.options;
  if (
    !Array.isArray(options) ||
    options.length === 0 ||
    // Every slot is read, so a hole (serialized as null) is refused rather
    // than skipped, as `every` alone would skip it.
    !Array.from(options as unknown[]).every(
      option =>
        isPlainRecord(option) &&
        typeof option.value === "string" &&
        typeof option.label === "string" &&
        // A label an author can see, or the control offers a blank choice.
        option.label.trim() !== ""
    )
  ) {
    return `${at} declares no options of { value, label }`;
  }
  // Each option is listed to every editor and checked on every save.
  if (options.length > NAMED_QUERY_MAX_OPTIONS) {
    return `${at} declares ${String(options.length)} options; at most ${String(NAMED_QUERY_MAX_OPTIONS)} are allowed`;
  }
  // A list stores the chosen value as an input's literal, which holds at
  // most NAMED_QUERY_TEXT_MAX characters: a longer value no list could save.
  if (
    param.options.some(option => option.value.length > NAMED_QUERY_TEXT_MAX)
  ) {
    return `${at} declares an option value longer than ${String(NAMED_QUERY_TEXT_MAX)} characters, which no list can store`;
  }
  const values = new Set(param.options.map(option => option.value));
  return values.size === options.length
    ? undefined
    : `${at} declares one option value twice`;
}

/**
 * What each input type must declare beyond a label, as the reason it does
 * not. A table, for the reason {@link VALUE_RULES} is one.
 */
const SHAPE_RULES: {
  readonly [T in NamedQueryParamType]: (
    param: Extract<NamedQueryParam, { readonly type: T }>,
    at: string,
    collections: ReadonlySet<string>
  ) => string | undefined;
} = {
  text: textShapeProblem,
  number: numberShapeProblem,
  boolean: () => undefined,
  choice: choiceShapeProblem,
  day: () => undefined,
  entry: (param, at, collections) =>
    collections.has(param.collection)
      ? undefined
      : `${at} chooses an entry of "${describeValue(param.collection)}", which the query does not declare in reads.collections`,
};

/** Why an input's default does not fit it, or nothing. */
function defaultProblem(
  param: NamedQueryParam,
  at: string
): string | undefined {
  if (!("default" in param) || param.default === undefined) return undefined;
  if (param.type === "day" && param.default === "today") return undefined;
  const wrong = valueProblem(param, param.default, "the query");
  return wrong === undefined
    ? undefined
    : `${at}'s default does not fit it: ${wrong}`;
}

/** Why a declared input is not one the editor can draw, or nothing. */
function paramShapeProblem(
  key: string,
  each: unknown,
  collections: ReadonlySet<string>
): string | undefined {
  const at = `input "${key}"`;
  if (!isPlainRecord(each)) return `${at} is not an input made with param.*`;
  if (typeof each.label !== "string" || each.label.trim() === "") {
    return `${at} has no label`;
  }
  if (each.label.length > NAMED_QUERY_LABEL_MAX) {
    return `${at}'s label is longer than ${String(NAMED_QUERY_LABEL_MAX)} characters`;
  }
  // `required` decides whether a list may leave the input out, so only a
  // yes or no can mean it.
  if (each.required !== undefined && typeof each.required !== "boolean") {
    return `${at}'s required is not true or false`;
  }
  const type = each.type;
  if (typeof type !== "string" || !Object.hasOwn(SHAPE_RULES, type)) {
    return `${at} has type "${describeValue(type)}", which is not one of text, number, boolean, choice, day or entry`;
  }
  const declared = each as unknown as NamedQueryParam;
  const rule = SHAPE_RULES[declared.type] as (
    param: NamedQueryParam,
    at: string,
    collections: ReadonlySet<string>
  ) => string | undefined;
  return rule(declared, at, collections) ?? defaultProblem(declared, at);
}

/** Why a row key does not name a declared text or number field, or nothing. */
function rowKeyProblem(
  rows: { readonly fields?: unknown; readonly key?: unknown },
  fields: readonly BindingFieldShape[]
): string | undefined {
  const key = fields.find(field => field.name === rows.key);
  if (key === undefined) {
    return `its rows' key "${describeValue(rows.key)}" is not one of its declared fields`;
  }
  if (key.hasMany === true || (key.type !== "text" && key.type !== "number")) {
    return `its rows' key "${key.name}" is not a text or number field holding one value`;
  }
  return undefined;
}

/** Why one declared row field is not one a binding can address, or nothing. */
function rowFieldProblem(
  field: unknown,
  at: string,
  seen: Set<string>,
  depth: number
): string | undefined {
  if (!isPlainRecord(field) || typeof field.type !== "string") {
    return `${at} hold a field that is not { name, type }`;
  }
  if (!isTopLevelFieldName(field.name)) {
    return `${at} hold a field named "${describeValue(field.name)}", which is not a field name a binding can address: letters, digits and underscores`;
  }
  // A binding finds a row field by its name, so a second field of one name
  // would be advertised and never judged by.
  if (seen.has(field.name))
    return `${at} hold two fields named "${field.name}"`;
  seen.add(field.name);
  if (field.fields === undefined) return undefined;
  const group = `${at}' field "${field.name}"`;
  return Array.isArray(field.fields)
    ? rowFieldsProblem(field.fields, group, depth + 1)
    : `${group} holds fields that are not a list`;
}

/**
 * Why declared row fields are not ones a binding can address, or nothing:
 * each a field shape with a type and a top-level field name, each name once
 * at its level, as a list's filter or a binding's path names one, a group's
 * own fields likewise.
 */
function rowFieldsProblem(
  fields: readonly unknown[],
  at: string,
  depth = 0
): string | undefined {
  // Bounded, so a schema that holds itself is refused, never walked forever.
  if (depth > NAMED_QUERY_MAX_ROW_DEPTH) {
    return `${at} nest fields more than ${String(NAMED_QUERY_MAX_ROW_DEPTH)} groups deep`;
  }
  const seen = new Set<string>();
  for (const field of fields) {
    const problem = rowFieldProblem(field, at, seen, depth);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** Why a declaration's rows are not a collection or a field schema with a key. */
function rowsProblem(
  rows: unknown,
  collections: ReadonlySet<string>
): string | undefined {
  if (!isPlainRecord(rows)) {
    return "its rows are not { collection } or { fields, key }";
  }
  // Read as every consumer reads it (`"fields" in rows`): rows holding
  // `fields` are a schema of their own, whatever else they hold, so both
  // shapes at once are refused, and `fields` is judged whenever it is there.
  if ("fields" in rows && "collection" in rows) {
    return "its rows name both a collection and fields; give { collection } or { fields, key }, not both";
  }
  if ("fields" in rows) {
    const fields = rows.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return "its rows are not { collection } or { fields, key }";
    }
    return (
      rowFieldsProblem(fields, "its rows") ??
      rowKeyProblem(rows, fields as BindingFieldShape[])
    );
  }
  if (typeof rows.collection === "string") {
    return collections.has(rows.collection)
      ? undefined
      : `its rows are entries of "${rows.collection}", which it does not declare in reads.collections`;
  }
  return "its rows are not { collection } or { fields, key }";
}

/** Why a declaration's reads are not lists of slugs, or nothing. */
function readsProblem(reads: unknown): string | undefined {
  if (!isPlainRecord(reads)) {
    return "it declares no reads: { collections, singles, site }";
  }
  if (reads.collections !== undefined && !isSlugList(reads.collections)) {
    return "its reads.collections is not a list of collection slugs";
  }
  if (reads.singles !== undefined && !isSlugList(reads.singles)) {
    return "its reads.singles is not a list of Single slugs";
  }
  if (reads.site !== undefined && typeof reads.site !== "boolean") {
    return "its reads.site is not true or false";
  }
  // Each declared read tags the query's cached result, and a cache entry
  // keeps a bounded number of tags: past it, a write to a source left off
  // would not refresh the page. The lists are counted as written, repeats
  // included, since every element is served and expanded into tags.
  const count =
    (reads.collections?.length ?? 0) +
    (reads.singles?.length ?? 0) +
    (reads.site === true ? 1 : 0);
  if (count > NAMED_QUERY_MAX_READS) {
    return `it declares ${String(count)} reads; at most ${String(NAMED_QUERY_MAX_READS)} are allowed, so each can refresh the page`;
  }
  return undefined;
}

/** Why a declaration's `total` flag is not true or false, or nothing. */
function totalProblem(total: unknown): string | undefined {
  // Clients read the flag as `=== true`, so any other present value would be
  // advertised as uncounted while the run still returned a count.
  return total === undefined || typeof total === "boolean"
    ? undefined
    : "its total is not true or false";
}

/** Why a declaration's own words and numbers are out of bounds, or nothing. */
function headerProblem(
  definition: Record<string, unknown>
): string | undefined {
  if (typeof definition.label !== "string" || definition.label.trim() === "") {
    return "it has no label";
  }
  if (definition.label.length > NAMED_QUERY_LABEL_MAX) {
    return `its label is longer than ${String(NAMED_QUERY_LABEL_MAX)} characters`;
  }
  if (
    definition.description !== undefined &&
    (typeof definition.description !== "string" ||
      definition.description.length > NAMED_QUERY_DESCRIPTION_MAX)
  ) {
    return `its description is not text of at most ${String(NAMED_QUERY_DESCRIPTION_MAX)} characters`;
  }
  if (typeof definition.run !== "function") return "it has no run function";
  const { timeoutMs, revalidate } = definition;
  if (
    timeoutMs !== undefined &&
    !(
      typeof timeoutMs === "number" &&
      Number.isSafeInteger(timeoutMs) &&
      timeoutMs >= 1 &&
      timeoutMs <= NAMED_QUERY_MAX_TIMEOUT_MS
    )
  ) {
    return `its timeoutMs is not a whole number from 1 to ${String(NAMED_QUERY_MAX_TIMEOUT_MS)}`;
  }
  if (
    revalidate !== undefined &&
    !(
      typeof revalidate === "number" &&
      Number.isSafeInteger(revalidate) &&
      revalidate >= 1
    )
  ) {
    return "its revalidate is not a whole number of seconds from 1";
  }
  return undefined;
}

/** Why a declaration's inputs cannot be drawn, or nothing. */
function paramsProblem(
  params: unknown,
  collections: ReadonlySet<string>
): string | undefined {
  if (params === undefined) return undefined;
  if (!isPlainRecord(params)) return "its params are not a record of inputs";
  const entries = Object.entries(params);
  if (entries.length > NAMED_QUERY_MAX_PARAMS) {
    return `it declares ${String(entries.length)} inputs; at most ${String(NAMED_QUERY_MAX_PARAMS)} are allowed`;
  }
  for (const [key, each] of entries) {
    if (!isNamedQueryParamKey(key) || key.length > NAMED_QUERY_NAME_MAX) {
      return `its input "${describeValue(key)}" is not a key of letters, digits and underscores, of at most ${String(NAMED_QUERY_NAME_MAX)} characters`;
    }
    const problem = paramShapeProblem(key, each, collections);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * Why a definition cannot be registered, or nothing when it can: the boot's
 * checks, judged on the value as given, since a definition is code a type
 * checker may not have seen. `known`, when given, is asked whether each
 * declared collection and Single exists; one it does not know is returned in
 * `unknownReads`, which a caller may log rather than refuse, since a
 * collection made in the admin is not in the code's configuration.
 */
export function namedQueryProblem(
  definition: unknown,
  known?: NamedQueryKnown
): { readonly problem?: string; readonly unknownReads: readonly string[] } {
  if (!isPlainRecord(definition)) {
    return { problem: "it is not a definition", unknownReads: [] };
  }
  const name = definition.name;
  if (!isNamedQueryName(name)) {
    return {
      problem: `its name "${describeValue(name)}" is not lowercase words joined by hyphens, in segments joined by dots, of at most ${String(NAMED_QUERY_NAME_MAX)} characters`,
      unknownReads: [],
    };
  }
  const reads = readsProblem(definition.reads);
  const problem =
    headerProblem(definition) ??
    totalProblem(definition.total) ??
    reads ??
    (() => {
      const collections = new Set(
        (definition.reads as NamedQueryDeclaration["reads"]).collections ?? []
      );
      return (
        rowsProblem(definition.rows, collections) ??
        paramsProblem(definition.params, collections)
      );
    })();
  if (problem !== undefined || known === undefined) {
    return { ...(problem === undefined ? {} : { problem }), unknownReads: [] };
  }
  const declared = definition.reads as NamedQueryDeclaration["reads"];
  const unknownReads = [
    ...(declared.collections ?? []).filter(slug => !known.collection(slug)),
    ...(declared.singles ?? []).filter(slug => !known.single(slug)),
  ];
  return { unknownReads };
}

/** A registered query, with the source that registered it. */
interface NamedQueryEntry {
  readonly definition: NamedQueryDefinition;
  readonly source: string;
}

/**
 * The named queries one site registers: one registry per page builder, so
 * two sites served from one process (one per tenant, say) never resolve each
 * other's queries. Answers as a {@link NamedQuerySource}, each declaration
 * without `run`.
 *
 * @experimental
 */
export interface NamedQueryRegistry extends NamedQuerySource {
  /**
   * Register definitions. All-or-nothing per call, as `registerBlocks` is:
   * every definition is checked before any is stored, and a name taken
   * twice names both sources. Returns the reads `options.known` did not
   * know, each named with its query, for the caller to log.
   */
  register(
    definitions: readonly NamedQueryDefinition[],
    options?: { readonly source?: string; readonly known?: NamedQueryKnown }
  ): { readonly unknownReads: readonly string[] };
  /** The registered query of that name, run function included. */
  definitionOf(name: string): NamedQueryDefinition | undefined;
  /** Every registered query, in registration order. */
  all(): readonly NamedQueryDefinition[];
}

/** Every definition checked, refused naming the source, before any is kept. */
function checkedBatch(
  definitions: readonly NamedQueryDefinition[],
  store: ReadonlyMap<string, NamedQueryEntry>,
  options: { readonly source: string; readonly known?: NamedQueryKnown }
): string[] {
  const { source } = options;
  const seen = new Set<string>();
  const unknownReads: string[] = [];
  for (const definition of definitions) {
    const judged = namedQueryProblem(definition, options.known);
    const name = isPlainRecord(definition)
      ? describeValue(definition.name)
      : "?";
    if (judged.problem !== undefined) {
      throw new Error(
        `NEXTLY_NAMED_QUERY_INVALID: named query "${name}" from "${source}" cannot be registered: ${judged.problem}.`
      );
    }
    const existing = store.get(definition.name);
    if (existing !== undefined) {
      throw new Error(
        `NEXTLY_NAMED_QUERY_COLLISION: named query "${definition.name}" is already registered by "${existing.source}" and cannot be registered again by "${source}".`
      );
    }
    if (seen.has(definition.name)) {
      throw new Error(
        `NEXTLY_NAMED_QUERY_COLLISION: named query "${definition.name}" is registered twice by "${source}".`
      );
    }
    seen.add(definition.name);
    unknownReads.push(
      ...judged.unknownReads.map(read => `"${definition.name}" reads "${read}"`)
    );
  }
  return unknownReads;
}

/**
 * A new, empty registry of named queries.
 *
 * @experimental
 */
export function createNamedQueryRegistry(): NamedQueryRegistry {
  const store = new Map<string, NamedQueryEntry>();
  return {
    register: (definitions, options = {}) => {
      const source = options.source ?? "app";
      const unknownReads = checkedBatch(definitions, store, {
        source,
        ...(options.known === undefined ? {} : { known: options.known }),
      });
      for (const definition of definitions) {
        store.set(definition.name, { definition, source });
      }
      return { unknownReads };
    },
    definitionOf: name => store.get(name)?.definition,
    declarationOf: name => {
      const found = store.get(name)?.definition;
      return found === undefined ? undefined : namedQueryDeclaration(found);
    },
    all: () => [...store.values()].map(entry => entry.definition),
  };
}

/**
 * The field shapes a list's items have when its source is the named query
 * `name`: its declared fields, or those `collectionFields` gives for the
 * collection its rows are entries of. `undefined` when either is unknown.
 */
export function namedQueryRowFields(
  source: NamedQuerySource,
  name: string,
  collectionFields: (
    collection: string
  ) => readonly BindingFieldShape[] | undefined
): readonly BindingFieldShape[] | undefined {
  const declaration = source.declarationOf(name);
  if (declaration === undefined) return undefined;
  const rows = declaration.rows;
  return "fields" in rows ? rows.fields : collectionFields(rows.collection);
}
