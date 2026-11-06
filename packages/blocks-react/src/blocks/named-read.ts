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
  getNamedQuery,
  isPlainRecord,
  judgeNamedParams,
  NAMED_QUERY_TEXT,
  namedQueryDeclaration,
  namedQueryTimeout,
  type BindingFieldShape,
  type ListNamedQuery,
  type NamedQueryDeclaration,
  type NamedQueryDefinition,
  type NamedQueryReader,
  type NamedQueryResult,
} from "@nextlyhq/blocks-engine";

import type {
  ListBaseReader,
  NamedQueryFailureCode,
  NamedQueryHost,
  NamedQueryRunData,
  PageContext,
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

/**
 * The reader handed to a named query's `run`: `base`, limited to what the
 * query declares, each read claimed through `claim` first.
 *
 * An undeclared read throws `undeclared-read` before anything is read; a
 * refused claim throws `budget`. The object is frozen, so `run` cannot swap
 * a method for one of its own.
 */
export function scopedReader(
  declaration: NamedQueryDeclaration,
  base: ListBaseReader,
  claim: () => boolean
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
    find: async query => {
      if (!collections.has(query.collection)) refuse(query.collection);
      spend();
      return await base.find(query);
    },
    count: async query => {
      if (!collections.has(query.collection)) refuse(query.collection);
      spend();
      return await base.count(query);
    },
    findSingle: async query => {
      if (!singles.has(query.slug)) refuse(query.slug);
      if (base.findSingle === undefined) {
        throw new Error("This page's reader cannot read a Single.");
      }
      spend();
      return await base.findSingle(query);
    },
    siteSettings: async () => {
      if (declaration.reads.site !== true) refuse("the site settings");
      if (base.siteSettings === undefined) {
        throw new Error("This page's reader cannot read the site settings.");
      }
      spend();
      return await base.siteSettings();
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
  const shapes = (await host.fieldsOf?.(rows.collection)) ?? [];
  return { fields: [...ENTRY_FIELDS, ...shapes], key: "id" };
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
  const reader = scopedReader(declaration, host.reader, () => {
    if (!claim()) return false;
    reads += 1;
    return true;
  });
  const timeout = namedQueryTimeout(declaration);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const call = () =>
    definition.run({
      params: args.params as never,
      window: args.window,
      reader,
      ...(args.locale === undefined ? {} : { locale: args.locale }),
      today: args.today,
      signal: controller.signal,
    });
  let result: NamedQueryResult;
  try {
    result = await untilAborted(
      host.runInFrame === undefined
        ? call()
        : host.runInFrame(definition.name, call),
      controller.signal,
      () =>
        new NamedQueryRunError(
          "timeout",
          `The named query "${definition.name}" ran longer than ${String(timeout)} ms.`
        )
    );
  } finally {
    clearTimeout(timer);
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

/** Whether a query's answer depends on the day it is run. */
function dependsOnToday(declaration: NamedQueryDeclaration): boolean {
  return (
    declaration.revalidate !== undefined ||
    Object.values(declaration.params ?? {}).some(
      each => each.type === "day" && each.default === "today"
    )
  );
}

/**
 * Each render's runs, by key, so a query a page draws several times (inside
 * an outer list) runs once per render. Keyed by the host, which is made per
 * render.
 */
const runsThisRender = new WeakMap<
  NamedQueryHost,
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
  readonly diagnostic?: {
    readonly kind: "query-failed";
    readonly message: string;
  };
  /** How many rows match before the window, when the query counts them. */
  readonly total?: number;
  /** The collection its rows are entries of; absent for a field schema. */
  readonly rowsCollection?: string;
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
  context.host.report?.({
    code,
    query: context.name,
    nodeId: context.nodeId,
    ref: context.ref ?? referenceFor(context.name, context.nodeId),
    ...(context.error === undefined ? {} : { error: context.error }),
  });
  return {
    items: [],
    failed: true,
    diagnostic: {
      kind: "query-failed",
      message: NAMED_QUERY_TEXT.runFailed(detail),
    },
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
 * Read a list's named query as its stored props ask. Never throws: a run
 * that fails comes back as `failed` with what failed, and the list draws its
 * empty state.
 *
 * `window` is the list's own limit and offset, as `list-read` reads them.
 */
export async function readNamedList(
  named: ListNamedQuery,
  window: { readonly limit: number; readonly offset: number },
  ctx: PageContext & { readonly namedQueries: NamedQueryHost },
  nodeId: string
): Promise<NamedListOutcome> {
  const host = ctx.namedQueries;
  const claim = () => ctx.queries?.take() !== false;
  const at = { host, name: named.name, nodeId };
  const definition = (host.definitionOf ?? getNamedQuery)(named.name);
  if (definition === undefined) {
    return failed("unknown", NAMED_QUERY_TEXT.removed(named.name), at);
  }
  const declaration = namedQueryDeclaration(definition);
  const today = await host.today();
  const judged = judgeNamedParams(declaration, named.params, {
    today,
    atRun: true,
  });
  const problem = judged.problems[0];
  if (problem !== undefined) return failed("params", problem.message, at);
  const key = [
    named.name,
    hashText(JSON.stringify(declaration)),
    stableJson(judged.values),
    String(window.limit),
    String(window.offset),
    ctx.locale ?? "",
    dependsOnToday(declaration) ? today : "",
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
  const runs = runsThisRender.get(host) ?? new Map();
  runsThisRender.set(host, runs);
  const memoKey = key.join("\u0000");
  const pending =
    runs.get(memoKey) ??
    (host.cache === undefined
      ? read()
      : host.cache({ declaration, key, read }));
  runs.set(memoKey, pending);
  let data: NamedQueryRunData;
  try {
    data = await pending;
  } catch (error) {
    const ref = referenceFor(named.name, nodeId);
    const why = classify(error, declaration, ref);
    return failed(why.code, why.detail, { ...at, ref, error });
  }
  if (!ranHere && !replayClaims(data.reads, claim)) {
    return failed("budget", NAMED_QUERY_TEXT.budget(declaration.label), at);
  }
  const rows = declaration.rows;
  return {
    items: data.rows,
    failed: false,
    ...(data.total === undefined ? {} : { total: data.total }),
    ...("collection" in rows ? { rowsCollection: rows.collection } : {}),
  };
}
