/**
 * How a collection list whose source is a named query reads its rows.
 *
 * The query is developer code. What it may read, and what of its answer a
 * page may draw, is decided here, the same for every base reader a host
 * supplies (a published page's public reader, an editor's canvas reader):
 *
 * - **Only declared reads.** `run` is handed {@link scopedReader}: a read of
 *   a collection, Single or the site settings the query does not declare is
 *   refused before it is made. The reader is frozen, and `run` gets no other
 *   handle: no instance, request, user or context.
 * - **Every read is counted** against the page's allowance, so a query that
 *   loops over its reader is bounded as nested lists are. A result the host
 *   kept from an earlier render claims as many again, so a page costs the
 *   same warm or cold.
 * - **Rows are projected** to what the query declares (its field schema, or
 *   the public fields of the collection its rows are entries of), and each
 *   row's key is checked: present, text or a number, and unique.
 * - **Time is bounded**, and the run's own reads see the abort.
 * - **A failure never throws.** The list draws its empty state; an author
 *   looking is told what failed in the engine's words, never the raw error,
 *   which goes to the host's log under a reference the note names.
 *
 * Inputs are judged by the engine's `judgeNamedParams`, the judgement the
 * save uses, so a value the save refuses never reaches developer code.
 *
 * @module blocks/named-read
 */
import {
  isPlainRecord,
  judgeNamedParams,
  NAMED_QUERY_TEXT,
  namedQueryDeclaration,
  namedQueryRowFields,
  namedQueryTimeout,
  type BindingFieldShape,
  type ListNamedQuery,
  type NamedQueryDeclaration,
  type NamedQueryDefinition,
  type NamedQueryReader,
} from "@nextlyhq/blocks-engine";

import type {
  ListBaseReader,
  NamedQueryFailure,
  NamedQueryFailureCode,
  NamedQueryHost,
  NamedQueryRunData,
  PageContext,
  QueryBudget,
} from "../context";

/**
 * Why a named query's run was stopped, as the renderer decides it: a read it
 * does not declare, the page's allowance spent, its time up, or rows it
 * cannot show.
 */
class NamedQueryRunError extends Error {
  readonly code: NamedQueryFailureCode;
  /** What was read without being declared, for `undeclared-read`. */
  readonly what?: string;

  constructor(code: NamedQueryFailureCode, message: string, what?: string) {
    super(message);
    this.name = "NamedQueryRunError";
    this.code = code;
    if (what !== undefined) this.what = what;
  }
}

/** A query as plain data: what a getter or a method on it would do runs now. */
function asData<Q>(query: Q): Q {
  return JSON.parse(JSON.stringify(query)) as Q;
}

/** The door that runs a read as it is: for a host with no frame. */
const OPEN_DOOR = <T>(operation: () => Promise<T>): Promise<T> => operation();

/**
 * The reader handed to a named query's `run`: `base`, limited to what the
 * query declares, each read claimed through `claim` first, and each made
 * through `door`, the host frame's way out for this reader alone.
 *
 * An undeclared read throws `undeclared-read` before anything is read; a
 * refused claim throws `budget`. Each query is copied to plain data before
 * it goes through the door, so nothing `run` hands over (a getter, say) runs
 * outside the frame. The object is frozen, so `run` cannot swap a method for
 * one of its own.
 */
export function scopedReader(
  declaration: NamedQueryDeclaration,
  base: ListBaseReader,
  claim: () => boolean,
  door: <T>(operation: () => Promise<T>) => Promise<T> = OPEN_DOOR
): NamedQueryReader {
  const collections = new Set(declaration.reads.collections ?? []);
  const singles = new Set(declaration.reads.singles ?? []);
  const refuse = (what: string): never => {
    throw new NamedQueryRunError(
      "undeclared-read",
      `The named query "${declaration.name}" read ${what}, which it does not declare.`,
      what
    );
  };
  const spend = () => {
    if (!claim()) {
      throw new NamedQueryRunError(
        "budget",
        `The page's read allowance was spent before "${declaration.name}" could read.`
      );
    }
  };
  return Object.freeze({
    find: async asked => {
      const query = asData(asked);
      if (!collections.has(query.collection)) refuse(query.collection);
      spend();
      return await door(() => base.find(query));
    },
    count: async asked => {
      const query = asData(asked);
      if (!collections.has(query.collection)) refuse(query.collection);
      spend();
      return await door(() => base.count(query));
    },
    findSingle: async asked => {
      const query = asData(asked);
      if (!singles.has(query.slug)) refuse(query.slug);
      if (base.findSingle === undefined) {
        throw new Error("This page's reader cannot read a Single.");
      }
      spend();
      return await door(async () => (await base.findSingle?.(query)) ?? null);
    },
    siteSettings: async () => {
      if (declaration.reads.site !== true) refuse("the site settings");
      if (base.siteSettings === undefined) {
        throw new Error("This page's reader cannot read the site settings.");
      }
      spend();
      return await door(async () => (await base.siteSettings?.()) ?? {});
    },
  } satisfies NamedQueryReader);
}

/** The fields every entry keeps besides its public fields. */
const ENTRY_FIELDS: readonly BindingFieldShape[] = [
  { name: "id", type: "text" },
  { name: "createdAt", type: "date" },
  { name: "updatedAt", type: "date" },
];

/** A value kept to the fields its shape declares, a group's own included. */
function projectValue(value: unknown, shape: BindingFieldShape): unknown {
  const nested = shape.fields;
  if (nested === undefined) return value;
  if (isPlainRecord(value)) return projectRow(value, nested);
  if (Array.isArray(value)) {
    return value.map((each: unknown) =>
      isPlainRecord(each) ? projectRow(each, nested) : each
    );
  }
  return value;
}

/** A row kept to the declared fields, each it holds. */
function projectRow(
  row: Readonly<Record<string, unknown>>,
  fields: readonly BindingFieldShape[]
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(row, field.name)) continue;
    kept[field.name] = projectValue(row[field.name], field);
  }
  return kept;
}

/**
 * A run's result as plain data: its JSON copy, which reads every own
 * enumerable property (running any getter) now, so nothing after reads a
 * live value `run` handed back. A cached result is this same copy.
 */
function asPlainResult(result: unknown): unknown {
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
}

/** The rows a run returned, cut to its window, or why they cannot be shown. */
function checkedRows(
  result: unknown,
  declaration: NamedQueryDeclaration,
  window: { readonly limit: number }
): Readonly<Record<string, unknown>>[] {
  const rows = isPlainRecord(result) ? result.rows : undefined;
  if (!Array.isArray(rows) || !rows.every(row => isPlainRecord(row))) {
    throw new NamedQueryRunError(
      "bad-rows",
      `The named query "${declaration.name}" returned something other than { rows: [...] }.`
    );
  }
  return (rows as Readonly<Record<string, unknown>>[]).slice(0, window.limit);
}

/** Refuse rows whose key is missing, not text or a number, or repeated. */
function assertKeys(
  rows: readonly Readonly<Record<string, unknown>>[],
  key: string,
  name: string
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    const usable =
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value));
    if (!usable || seen.has(String(value))) {
      throw new NamedQueryRunError(
        "bad-rows",
        `The named query "${name}" gave a row whose key "${key}" is ${usable ? "repeated" : "missing"}.`
      );
    }
    seen.add(String(value));
  }
}

/** The fields a query's rows keep: its schema, or the collection's public ones. */
async function rowFields(
  declaration: NamedQueryDeclaration,
  host: NamedQueryHost
): Promise<{ fields: readonly BindingFieldShape[]; key: string }> {
  const rows = declaration.rows;
  if ("fields" in rows) {
    const keyed = rows.fields.some(field => field.name === rows.key);
    return {
      fields: keyed
        ? rows.fields
        : [...rows.fields, { name: rows.key, type: "text" }],
      key: rows.key,
    };
  }
  // A host that judges access and answers nothing is saying visitors may
  // read none of the collection: no row of it is shown, not even its id.
  // A host that judges nothing keeps each row's id and timestamps.
  const shapes = await host.fieldsOf?.(rows.collection);
  if (host.fieldsOf !== undefined && shapes === undefined) {
    throw rowsHiddenError(declaration, rows.collection);
  }
  return { fields: [...ENTRY_FIELDS, ...(shapes ?? [])], key: "id" };
}

/** The refusal of rows from a collection visitors may read none of. */
function rowsHiddenError(
  declaration: NamedQueryDeclaration,
  collection: string
): NamedQueryRunError {
  return new NamedQueryRunError(
    "rows-hidden",
    `The named query "${declaration.name}" lists entries of "${collection}", which visitors may not read.`,
    collection
  );
}

/** Wait for `work`, or reject once `signal` aborts. */
async function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  onAbort: () => Error
): Promise<T> {
  let stop: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => reject(onAbort());
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (stop !== undefined) signal.removeEventListener("abort", stop);
  }
}

/** One run of a query, made now: its rows projected and checked. */
async function execute(
  definition: NamedQueryDefinition,
  args: {
    readonly params: Readonly<Record<string, unknown>>;
    readonly window: { readonly limit: number; readonly offset: number };
    readonly locale?: string;
    readonly today: string;
  },
  host: NamedQueryHost,
  claim: () => boolean
): Promise<NamedQueryRunData> {
  const declaration = namedQueryDeclaration(definition);
  let reads = 0;
  // Closed once the run is over, on time or not: work `run` left going (it
  // ignored its signal, say) makes no read after the page has moved on.
  let closed = false;
  const timeout = namedQueryTimeout(declaration);
  // One frame per run: the query runs inside it, and only its reader reads,
  // through the frame's own door.
  const frame = host.frame?.(definition.name);
  const reader = scopedReader(
    declaration,
    host.reader,
    () => {
      if (closed) {
        throw new NamedQueryRunError(
          "timeout",
          `The named query "${definition.name}" read after its run was over.`
        );
      }
      if (!claim()) return false;
      reads += 1;
      return true;
    },
    frame === undefined ? undefined : operation => frame.read(operation)
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // The result is copied to plain data inside the frame, as `run`'s own
  // code: a getter on it, or on a row, runs there, under the frame's
  // refusals, never later while the rows are checked and projected.
  const call = async () =>
    asPlainResult(
      await definition.run({
        params: args.params as never,
        window: args.window,
        reader,
        ...(args.locale === undefined ? {} : { locale: args.locale }),
        today: args.today,
        signal: controller.signal,
      })
    );
  let result: unknown;
  try {
    result = await untilAborted(
      (async () => await (frame === undefined ? call() : frame.run(call)))(),
      controller.signal,
      () =>
        new NamedQueryRunError(
          "timeout",
          `The named query "${definition.name}" ran longer than ${String(timeout)} ms.`
        )
    );
  } finally {
    clearTimeout(timer);
    closed = true;
    // Told to stop, whatever it still has going.
    controller.abort();
  }
  const rows = checkedRows(result, declaration, args.window);
  const shape = await rowFields(declaration, host);
  assertKeys(rows, shape.key, definition.name);
  const total = (result as { total?: unknown }).total;
  return {
    rows: rows.map(row => projectRow(row, shape.fields)),
    ...(typeof total === "number" && Number.isSafeInteger(total) && total >= 0
      ? { total }
      : {}),
    reads,
  };
}

/**
 * Where a host's named queries are looked up: its own lookup, which knows
 * the queries of the site it renders, or none without a host. The one answer
 * the run and the binding checks of its rows share, so a list's items are
 * judged against the query that made them.
 */
function namedQueryLookup(
  host: Pick<NamedQueryHost, "definitionOf"> | undefined
): (name: string) => NamedQueryDefinition | undefined {
  return host?.definitionOf ?? (() => undefined);
}

/**
 * The fields a row of the named query `query` carries, as a host's queries
 * declare them: its own schema, or the public fields of the collection its
 * rows are entries of (`collectionFields`). `undefined` when either is not
 * known. The one reading a row's bindings and its blocks' visibility
 * conditions share, so both judge a row by the same fields.
 */
export function queryRowFields(
  host: Pick<NamedQueryHost, "definitionOf"> | undefined,
  query: string,
  collectionFields: (
    collection: string
  ) => readonly BindingFieldShape[] | undefined
): readonly BindingFieldShape[] | undefined {
  const lookup = namedQueryLookup(host);
  return namedQueryRowFields(
    { declarationOf: name => lookup(name) },
    query,
    collectionFields
  );
}

/** What an error is, for a log: its code or its class, never its words. */
function errorKind(error: unknown): string {
  if (typeof error !== "object" || error === null) return typeof error;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) {
    return code;
  }
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && /^[A-Za-z0-9_]{1,64}$/.test(name)
    ? name
    : "error";
}

/**
 * A failed run's log line: where it failed, the query, its code and the
 * reference an author is shown, and what the error was by its code or its
 * class. Never the error's message, values or stack, which hold whatever the
 * query's code or a provider put in them, a credential among them.
 */
export function namedQueryFailureLine(
  failure: NamedQueryFailure,
  where: string
): string {
  const kind =
    failure.error === undefined ? "" : ` (${errorKind(failure.error)})`;
  return `[blocks] The named query "${failure.query}" in list "${failure.nodeId}" on ${where} failed: ${failure.code}${kind}, so the list shows its empty state. Reference ${failure.ref}.`;
}

/** A value as JSON with its keys in order, so one set of inputs is one key. */
function stableJson(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map(key => [key, value[key]])
  );
}

/** A 32-bit FNV-1a hash of a text, as eight hex digits. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** A log reference for one failure: `NQ-` and six hex digits. */
function referenceFor(name: string, nodeId: string): string {
  const seed = `${String(Date.now())}:${nodeId}:${name}:${String(Math.random())}`;
  return `NQ-${hashText(seed).slice(0, 6).toUpperCase()}`;
}

/**
 * Each render's runs, by key, so a query a page draws several times (inside
 * an outer list) runs once per render. Owned by the render's read allowance
 * (`ctx.queries`), which a page makes for each render and never shares: a
 * host may well be kept across renders, and a run kept with it would serve
 * the first render's rows to every later one. A render with no allowance
 * keeps nothing.
 */
const runsThisRender = new WeakMap<
  object,
  Map<string, Promise<NamedQueryRunData>>
>();

/** The public message of a `NextlyError` a developer threw, when there is one. */
function publicMessageOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    publicMessage?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  return typeof candidate.publicMessage === "string" &&
    candidate.publicMessage !== "" &&
    typeof candidate.statusCode === "number" &&
    typeof candidate.code === "string"
    ? candidate.publicMessage
    : undefined;
}

/** The codes a failed run can carry, as a set to judge a carried one by. */
const FAILURE_CODES: ReadonlySet<string> = new Set<NamedQueryFailureCode>([
  "unknown",
  "params",
  "undeclared-read",
  "trusted-read",
  "budget",
  "timeout",
  "bad-rows",
  "rows-hidden",
  "threw",
  "uncounted",
]);

/** A log reference as a failure names it: `NQ-` and six hex digits. */
const REFERENCE = /^NQ-[0-9A-F]{6}$/;

/**
 * A run that failed somewhere else, as the place that ran it told it: an
 * editor's canvas runs its named queries on the server, which judged the
 * failure, logged it under `ref` and words it as `detail`.
 *
 * @experimental
 */
export interface CarriedNamedQueryFailure {
  readonly code: NamedQueryFailureCode;
  readonly detail: string;
  readonly ref: string;
  /**
   * How many reads the failed run made before it stopped, which the render
   * that asked claims from its own allowance, as it claims a run's that
   * succeeded.
   */
  readonly reads?: number;
}

/**
 * The failure an error carries from the place that ran the query, on its
 * `namedQueryFailure`; `undefined` for any other error, or one whose
 * carried failure is not one a run can have.
 */
export function carriedFailureOf(
  error: unknown
): CarriedNamedQueryFailure | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const carried: unknown = (error as { namedQueryFailure?: unknown })
    .namedQueryFailure;
  if (!isPlainRecord(carried)) return undefined;
  const { code, detail, ref, reads } = carried;
  const counted =
    typeof reads === "number" && Number.isSafeInteger(reads) && reads > 0;
  return typeof code === "string" &&
    FAILURE_CODES.has(code) &&
    typeof detail === "string" &&
    detail !== "" &&
    typeof ref === "string" &&
    REFERENCE.test(ref)
    ? {
        code: code as NamedQueryFailureCode,
        detail,
        ref,
        ...(counted ? { reads } : {}),
      }
    : undefined;
}

/** What failed, as a code and the words an author is shown. */
function classify(
  error: unknown,
  declaration: NamedQueryDeclaration,
  ref: string
): { code: NamedQueryFailureCode; detail: string } {
  const label = declaration.label;
  if (error instanceof NamedQueryRunError) {
    switch (error.code) {
      case "undeclared-read":
        return {
          code: error.code,
          detail: NAMED_QUERY_TEXT.undeclaredRead(label, error.what ?? "data"),
        };
      case "budget":
        return { code: error.code, detail: NAMED_QUERY_TEXT.budget(label) };
      case "timeout":
        return {
          code: error.code,
          detail: NAMED_QUERY_TEXT.timeout(
            label,
            namedQueryTimeout(declaration) / 1000
          ),
        };
      case "bad-rows":
        return { code: error.code, detail: NAMED_QUERY_TEXT.badRows(label) };
      case "rows-hidden":
        return {
          code: error.code,
          detail: NAMED_QUERY_TEXT.rowsHidden(label, error.what ?? "its rows"),
        };
      default:
        break;
    }
  }
  const reason = (error as { logContext?: { reason?: unknown } } | null)
    ?.logContext?.reason;
  if (reason === "named-query-trusted-read") {
    return {
      code: "trusted-read",
      detail: NAMED_QUERY_TEXT.trustedRead(label),
    };
  }
  return {
    code: "threw",
    detail: publicMessageOf(error) ?? NAMED_QUERY_TEXT.threw(label, ref),
  };
}

/** What a named query's list read came to. */
export interface NamedListOutcome {
  readonly items: readonly Record<string, unknown>[];
  readonly failed: boolean;
  /**
   * What an author is told: why the run failed, or, for one that ran, what
   * a visitor's page goes without. `ref` is the log reference the message
   * names, when it names one, so an editor can offer it to copy.
   */
  readonly diagnostic?: {
    readonly kind: "query-failed" | "query-caution";
    readonly message: string;
    readonly ref?: string;
  };
  /** A failed run, as the place that ran it would carry it elsewhere. */
  readonly failure?: CarriedNamedQueryFailure;
  /** How many rows match before the window, when the query counts them. */
  readonly total?: number;
  /** The collection its rows are entries of; absent for a field schema. */
  readonly rowsCollection?: string;
  /** The field each row is keyed by: the declared key, or the entry's id. */
  readonly rowKey?: string;
}

/** A failed read: the empty state, the author's words, and the host's log. */
function failed(
  code: NamedQueryFailureCode,
  detail: string,
  context: {
    readonly host: NamedQueryHost;
    readonly name: string;
    readonly nodeId: string;
    readonly ref?: string;
    readonly error?: unknown;
  }
): NamedListOutcome {
  const ref = context.ref ?? referenceFor(context.name, context.nodeId);
  // A log that fails must not fail the list: it still draws its empty state.
  try {
    context.host.report?.({
      code,
      query: context.name,
      nodeId: context.nodeId,
      ref,
      ...(context.error === undefined ? {} : { error: context.error }),
    });
  } catch {
    // Nothing more to do: the outcome below is what the page draws.
  }
  return {
    items: [],
    failed: true,
    diagnostic: {
      kind: "query-failed",
      // A query that doesn't count is a setting refused, not a read that
      // failed: its own words say what to change, and nothing failed to load.
      message:
        code === "uncounted" ? detail : NAMED_QUERY_TEXT.runFailed(detail),
      // Offered to copy only where the words name it, as a thrown error's do.
      ...(detail.includes(ref) ? { ref } : {}),
    },
    failure: { code, detail, ref },
  };
}

/** Claim `count` reads again, for a result this render did not make. */
function replayClaims(count: number, claim: () => boolean): boolean {
  for (let index = 0; index < count; index += 1) {
    if (!claim()) return false;
  }
  return true;
}

/**
 * What every render asks before the run, cached or not, inside the same
 * containment as the run: the render's day, and whether visitors may still
 * read the collection the query's rows are entries of. A kept result made
 * before its collection was closed to visitors is never drawn from. A
 * failure to resolve either draws the empty state, never fails the page.
 */
async function beforeRun(
  host: NamedQueryHost,
  declaration: NamedQueryDeclaration,
  at: {
    readonly host: NamedQueryHost;
    readonly name: string;
    readonly nodeId: string;
  }
): Promise<string | NamedListOutcome> {
  try {
    const rows = declaration.rows;
    if ("collection" in rows && host.fieldsOf !== undefined) {
      if ((await host.fieldsOf(rows.collection)) === undefined) {
        return failed(
          "rows-hidden",
          NAMED_QUERY_TEXT.rowsHidden(declaration.label, rows.collection),
          at
        );
      }
    }
    return await host.today();
  } catch (error) {
    const ref = referenceFor(at.name, at.nodeId);
    return failed("threw", NAMED_QUERY_TEXT.threw(declaration.label, ref), {
      ...at,
      ref,
      error,
    });
  }
}

/**
 * A run this render already started under `key`, or `start`'s, kept with
 * the render's allowance (`owner`) for the rest of the render. Nothing is
 * kept for a render with no allowance. A failed run is not kept either: an
 * allowance an editor holds for its life would otherwise answer every later
 * draw with the same failure.
 */
function renderRun(
  owner: QueryBudget | undefined,
  key: string,
  start: () => Promise<NamedQueryRunData>
): { readonly pending: Promise<NamedQueryRunData>; readonly joined: boolean } {
  if (owner === undefined) return { pending: start(), joined: false };
  // The render's own generation, so a budget an editor keeps for its life
  // keeps no run past the draw it was made in.
  const holder = owner.generation?.() ?? owner;
  const runs =
    runsThisRender.get(holder) ?? new Map<string, Promise<NamedQueryRunData>>();
  runsThisRender.set(holder, runs);
  const started = runs.get(key);
  if (started !== undefined) return { pending: started, joined: true };
  const pending = start();
  runs.set(key, pending);
  pending.catch(() => {
    if (runs.get(key) === pending) runs.delete(key);
  });
  return { pending, joined: false };
}

/** The reads a render's allowance has left, when it can say. */
function allowanceOf(budget: QueryBudget | undefined): {
  readonly allowance?: number;
} {
  const left = budget?.remaining?.();
  return left === undefined ? {} : { allowance: left };
}

/**
 * A run that threw, as the list draws it. A failure judged where the run
 * was made keeps that place's words and the reference its log names it by;
 * any other is judged here, under a reference made for it.
 */
function failedRun(
  error: unknown,
  declaration: NamedQueryDeclaration,
  at: {
    readonly host: NamedQueryHost;
    readonly name: string;
    readonly nodeId: string;
  }
): NamedListOutcome {
  const carried = carriedFailureOf(error);
  if (carried !== undefined) {
    return failed(carried.code, carried.detail, {
      ...at,
      ref: carried.ref,
      error,
    });
  }
  const ref = referenceFor(at.name, at.nodeId);
  const why = classify(error, declaration, ref);
  return failed(why.code, why.detail, { ...at, ref, error });
}

/** A run that gave rows, with what an author is told about it, if anything. */
function succeeded(
  data: NamedQueryRunData,
  declaration: NamedQueryDeclaration,
  host: NamedQueryHost
): NamedListOutcome {
  const rows = declaration.rows;
  const caution = host.caution?.(declaration);
  return {
    items: data.rows,
    failed: false,
    ...(data.total === undefined ? {} : { total: data.total }),
    rowKey: "fields" in rows ? rows.key : "id",
    ...("collection" in rows ? { rowsCollection: rows.collection } : {}),
    ...(caution === undefined
      ? {}
      : { diagnostic: { kind: "query-caution", message: caution } }),
  };
}

/**
 * Read a list's named query as its stored props ask. Never throws: a run
 * that fails comes back as `failed` with what failed, and the list draws its
 * empty state.
 *
 * `window` is the list's own limit and offset, as `list-read` reads them,
 * moved to the page drawn where the list is split into pages. `counted`
 * says the list counts its pages from the run's total, so a run that
 * returns none fails (`uncounted`) rather than letting anything guess how
 * many pages there are: a query whose declaration changed since the page
 * was saved.
 */
export async function readNamedList(
  named: ListNamedQuery,
  window: { readonly limit: number; readonly offset: number },
  ctx: PageContext & { readonly namedQueries: NamedQueryHost },
  nodeId: string,
  options: { readonly counted?: boolean } = {}
): Promise<NamedListOutcome> {
  const host = ctx.namedQueries;
  const claim = () => ctx.queries?.take({ kind: "entries", nodeId }) !== false;
  const at = { host, name: named.name, nodeId };
  const definition = namedQueryLookup(host)(named.name);
  if (definition === undefined) {
    return failed("unknown", NAMED_QUERY_TEXT.removed(named.name), at);
  }
  const declaration = namedQueryDeclaration(definition);
  const day = await beforeRun(host, declaration, at);
  if (typeof day !== "string") return day;
  const today = day;
  const judged = judgeNamedParams(declaration, named.params, {
    today,
    atRun: true,
  });
  const problem = judged.problems[0];
  if (problem !== undefined) return failed("params", problem.message, at);
  const key = [
    named.name,
    hashText(JSON.stringify(declaration)),
    // The implementation too: a deployment that changes only `run` must not
    // be served the rows the old one made.
    hashText(definition.run.toString()),
    stableJson(judged.values),
    String(window.limit),
    String(window.offset),
    ctx.locale ?? "",
    // Today always: `run` is handed it whether or not the query declares
    // that it depends on it, so a result never outlives its day.
    today,
  ];
  let ranHere = false;
  const read = () => {
    ranHere = true;
    return execute(
      definition,
      {
        params: judged.values,
        window,
        ...(ctx.locale === undefined ? {} : { locale: ctx.locale }),
        today,
      },
      host,
      claim
    );
  };
  const { pending, joined } = renderRun(ctx.queries, key.join("\u0000"), () =>
    host.cache === undefined
      ? read()
      : host.cache({
          declaration,
          key,
          read,
          asked: {
            params: named.params,
            window,
            node: nodeId,
            ...allowanceOf(ctx.queries),
          },
        })
  );
  let data: NamedQueryRunData;
  try {
    data = await pending;
  } catch (error) {
    // A run made elsewhere that read and then failed cost those reads too:
    // claimed here, once, as a run that succeeded is, so failing lists share
    // the page's allowance rather than each spending a fresh one.
    const spent = carriedFailureOf(error)?.reads ?? 0;
    if (!ranHere && !joined) replayClaims(spent, claim);
    return failedRun(error, declaration, at);
  }
  // Reads are claimed once per render for each run: as made, or, for a
  // result the host's cache kept from another render, claimed again. A list
  // joining a run this render already made claims nothing more: no read is
  // made for it.
  if (!ranHere && !joined && !replayClaims(data.reads, claim)) {
    return failed("budget", NAMED_QUERY_TEXT.budget(declaration.label), at);
  }
  // Checked after the run's reads are claimed, so a page costs the same
  // whether or not its query still counts. Counting is what the query
  // declares, as the save and the editor judge it: a total a query returns
  // without declaring one is not counted on.
  if (
    options.counted === true &&
    (declaration.total !== true || data.total === undefined)
  ) {
    return failed(
      "uncounted",
      NAMED_QUERY_TEXT.uncounted(declaration.label),
      at
    );
  }
  return succeeded(data, declaration, host);
}
