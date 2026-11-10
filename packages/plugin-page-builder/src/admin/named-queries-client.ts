"use client";

/**
 * A collection list's custom sources in the editor: the site's named queries
 * through the named queries route, and the canvas's runs of them through the
 * list entries route, where their run functions live.
 *
 * - **The Source menu and Inputs** read each query's declaration, without
 *   its run function, through `listCustomSources`, which the builder's
 *   content services lend.
 * - **The canvas** draws a list whose source is a named query with the
 *   renderer's own `readNamedList`, over a host whose runs are made on the
 *   server (`canvasNamedHost`): the same judgement, the same rows, the same
 *   failure under the same log reference as a preview. The host's lookup is
 *   also what a list item's bindings are checked against, so a binding to a
 *   row field is judged by the fields the query declares.
 * - **The count** under Number of items is taken from the same run, with
 *   the canvas's kept answers, so it reads nothing of its own.
 *
 * It decides nothing about access: the routes do.
 *
 * @module admin/named-queries-client
 */
import {
  isPlainRecord,
  NAMED_QUERY_TEXT,
  type NamedQueryDeclaration,
  type NamedQueryDefinition,
  type NamedQueryHiddenRead,
  type NamedQueryParamValue,
} from "@nextlyhq/blocks-engine";
import {
  createQueryBudget,
  createStandaloneContext,
  type ListBaseReader,
  type NamedQueryHost,
} from "@nextlyhq/blocks-react";
import {
  namedListBase,
  readNamedList,
  type ListEntryCount,
} from "@nextlyhq/blocks-react/blocks";
import { readPluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
// The CONTRACTS, not the routes: the routes read the server's registry.
import {
  LIST_ENTRIES_ROUTE_PATH,
  type ListEntriesNamedRequest,
  type ListEntriesNamedResponse,
  type ListEntriesVisitor,
} from "../list-entries-contract";
import {
  namedQueriesPath,
  type NamedQueriesResponse,
} from "../named-queries-contract";

/** One custom source, as the builder's Source menu and Inputs read it. */
export interface CanvasCustomSource {
  readonly declaration: NamedQueryDeclaration;
  readonly readsHidden: readonly NamedQueryHiddenRead[];
}

/** Said when the route answered with something that is not a list of queries. */
const UNEXPLAINED = "Custom sources could not be listed. Try again.";

/** A declaration as the route sends it, kept only when it is one. */
function declarationOf(value: unknown): NamedQueryDeclaration | undefined {
  if (!isPlainRecord(value)) return undefined;
  const { name, label, reads, rows, params } = value;
  // The route sends the engine's run-free declaration; one that is not its
  // shape is left out rather than drawn as a source nobody can set.
  return typeof name === "string" &&
    typeof label === "string" &&
    isPlainRecord(reads) &&
    isPlainRecord(rows) &&
    (params === undefined || isPlainRecord(params))
    ? (value as unknown as NamedQueryDeclaration)
    : undefined;
}

/** A hidden read as the route sends it, kept only when it is one. */
function hiddenReadOf(value: unknown): NamedQueryHiddenRead | undefined {
  if (!isPlainRecord(value)) return undefined;
  const { collection, label, fields } = value;
  return typeof collection === "string" &&
    typeof label === "string" &&
    Array.isArray(fields) &&
    fields.every(field => typeof field === "string")
    ? { collection, label, fields: fields }
    : undefined;
}

/**
 * List the site's custom sources, in `locale`, the language visitors'
 * access is judged in. Rejects when the route refused or failed, so the
 * Source menu offers what it did before rather than an empty group.
 */
export async function listCustomSources(
  locale?: string
): Promise<readonly CanvasCustomSource[]> {
  const body = await readPluginRoute<NamedQueriesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: namedQueriesPath(locale),
  });
  const items =
    typeof body === "object" && body !== null
      ? (body as Partial<NamedQueriesResponse>).items
      : undefined;
  if (!Array.isArray(items)) throw new Error(UNEXPLAINED);
  return items.flatMap((item: unknown) => {
    if (!isPlainRecord(item)) return [];
    const declaration = declarationOf(item.declaration);
    if (declaration === undefined) return [];
    const hidden = Array.isArray(item.readsHidden) ? item.readsHidden : [];
    return [
      {
        declaration,
        readsHidden: hidden.flatMap((each: unknown) => {
          const read = hiddenReadOf(each);
          return read === undefined ? [] : [read];
        }),
      },
    ];
  });
}

/**
 * The reader the canvas's host is never asked for: a query's run is made on
 * the server, where its reader is the route's, so a read asked of this one
 * means the run was attempted in the browser, and is refused.
 */
function refused(): Promise<never> {
  return Promise.reject(new Error("A named query runs on the server."));
}
const SERVER_ONLY_READER: ListBaseReader = {
  find: refused,
  count: refused,
};

/** Today in this browser, `YYYY-MM-DD`: the run's own today is the server's. */
function browserDay(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** How long a run's answer is kept, so the page drawn again runs nothing new. */
const KEPT_FOR_MS = 15_000;

/**
 * A failure the route answered, as the renderer reads a carried one, with
 * the reads the run made before it failed, which the canvas claims.
 */
function carried(
  failure: NonNullable<ListEntriesNamedResponse["meta"]["named"]["failure"]>,
  reads: number
): Error {
  return Object.assign(new Error(failure.detail), {
    namedQueryFailure: { ...failure, reads },
  });
}

/**
 * A run refused before it starts, the draw's allowance spent: carried as the
 * renderer reads a budget failure, under a reference of its own, since the
 * server never saw it and logged nothing.
 */
function spentAllowance(label: string): Error {
  const ref = `NQ-${Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .toUpperCase()
    .padStart(6, "0")}`;
  return Object.assign(new Error("The page's read allowance is spent."), {
    namedQueryFailure: {
      code: "budget",
      detail: NAMED_QUERY_TEXT.budget(label),
      ref,
    },
  });
}

/** The route's refusal, worded as a refusal the renderer shows the words of. */
function refusalOf(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const { code, status } = error as Error & {
    code?: unknown;
    status?: unknown;
  };
  return Object.assign(new Error(error.message), {
    publicMessage: error.message,
    code: typeof code === "string" ? code : "UNKNOWN",
    statusCode: typeof status === "number" ? status : 500,
  });
}

/** One run, through the route. */
async function runThrough(
  body: ListEntriesNamedRequest
): Promise<ListEntriesNamedResponse> {
  try {
    const answer = await writePluginRoute<ListEntriesNamedResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: LIST_ENTRIES_ROUTE_PATH,
      method: "POST",
      body,
    });
    if (answer === undefined || !Array.isArray(answer.items)) {
      throw new Error("The list's entries could not be read.");
    }
    return answer;
  } catch (error) {
    throw refusalOf(error);
  }
}

/**
 * The canvas's runs: each distinct run made once and its answer kept a
 * short while once it settles, a run in flight shared however long it
 * takes (a query may run longer than an answer is kept). A refusal is not
 * kept, nor an answer saying the run failed, so the next draw asks again;
 * only the run that failed is dropped, never one started after it. Runs
 * are told apart by what they ask, the list they are for aside, so two
 * lists of one query share a run.
 */
export function canvasNamedRuns(
  run: (
    body: ListEntriesNamedRequest
  ) => Promise<ListEntriesNamedResponse> = runThrough,
  now: () => number = Date.now
): (body: ListEntriesNamedRequest) => Promise<ListEntriesNamedResponse> {
  /** One run, and when its answer arrived, if it has. */
  interface Kept {
    readonly answer: Promise<ListEntriesNamedResponse>;
    settledAt?: number;
  }
  const kept = new Map<string, Kept>();
  return async body => {
    const key = JSON.stringify({ ...body.named, node: undefined });
    const held = kept.get(key);
    if (
      held !== undefined &&
      (held.settledAt === undefined || now() - held.settledAt < KEPT_FOR_MS)
    ) {
      return held.answer;
    }
    const entry: Kept = { answer: run(body) };
    kept.set(key, entry);
    const drop = () => {
      if (kept.get(key) === entry) kept.delete(key);
    };
    entry.answer.then(answer => {
      // A run that failed answers as a run made, and is asked again next.
      if (answer.meta.named.failure === undefined) entry.settledAt = now();
      else drop();
    }, drop);
    return entry.answer;
  };
}

/** Stored inputs as a run is asked for them: literals only. */
function literals(
  params: Readonly<Record<string, unknown>>
): Record<string, NamedQueryParamValue> {
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, NamedQueryParamValue] =>
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean"
    )
  );
}

/**
 * The canvas's host for named queries: the site's queries looked up from
 * their declarations, each run made on the server through `run`, and, for
 * a query reading what visitors can't, the note saying what a visitor's
 * page goes without.
 */
export function canvasNamedHost(
  sources: readonly CanvasCustomSource[],
  run: (body: ListEntriesNamedRequest) => Promise<ListEntriesNamedResponse>,
  locale: string | undefined
): NamedQueryHost {
  const byName = new Map(
    sources.map(source => [source.declaration.name, source])
  );
  return {
    definitionOf: (name): NamedQueryDefinition | undefined => {
      const source = byName.get(name);
      return source === undefined
        ? undefined
        : { ...source.declaration, run: refused };
    },
    reader: SERVER_ONLY_READER,
    today: () => Promise.resolve(browserDay(new Date())),
    // The run is the server's: asked for as the list stores it, judged and
    // made there, and its answer taken as this render's result.
    cache: async ({ declaration, asked }) => {
      // The run is asked for as the list stores it; a caller that cannot
      // say so has nothing the server could run.
      if (asked === undefined) {
        throw new Error(
          "A named query on the canvas needs the run as its list stores it."
        );
      }
      // Nothing left of the draw's allowance: no run is started, as a read
      // the page could not claim is never made.
      if (asked.allowance === 0) throw spentAllowance(declaration.label);
      const answer = await run({
        named: {
          name: declaration.name,
          params: literals(asked.params),
          limit: asked.window.limit,
          offset: asked.window.offset,
          ...(locale === undefined ? {} : { locale }),
          ...(asked.allowance === undefined
            ? {}
            : { allowance: asked.allowance }),
          // The list it is for, so the server's log names it.
          ...(asked.node === undefined ? {} : { node: asked.node }),
        },
      });
      const named = answer.meta.named;
      if (named.failure !== undefined) {
        throw carried(named.failure, named.reads);
      }
      return {
        rows: [...answer.items],
        ...(named.counted ? { total: answer.meta.total } : {}),
        reads: named.reads,
      };
    },
    caution: declaration => {
      const hidden = byName.get(declaration.name)?.readsHidden ?? [];
      if (hidden.length === 0) return undefined;
      return hidden
        .map(read =>
          NAMED_QUERY_TEXT.readsHiddenCanvas(
            declaration.label,
            read.label,
            read.fields
          )
        )
        .join(" ");
    },
  };
}

/**
 * The count under Number of items for a list whose source is a named query:
 * the run the canvas draws it with, kept, so the count is of the rows on the
 * canvas. Nothing for a query that does not count its rows, or another list.
 */
export async function namedListCount(
  props: Readonly<Record<string, unknown>>,
  host: NamedQueryHost,
  locale: string | undefined
): Promise<ListEntryCount | undefined> {
  const outcome = await namedListRun(props, host, locale);
  return outcome?.total === undefined
    ? undefined
    : { matching: outcome.total, shown: outcome.items.length };
}

/**
 * How many rows a named list draws, from the canvas's own run: what a
 * visitor-read list's tag compares, known whether or not the query says how
 * many rows match. Undefined for a list whose source can't be run as stored.
 */
export async function namedListShown(
  props: Readonly<Record<string, unknown>>,
  host: NamedQueryHost,
  locale: string | undefined
): Promise<number | undefined> {
  const outcome = await namedListRun(props, host, locale);
  return outcome === undefined || outcome.failed
    ? undefined
    : outcome.items.length;
}

/** A named list's run as the canvas makes it, for a count of it. */
async function namedListRun(
  props: Readonly<Record<string, unknown>>,
  host: NamedQueryHost,
  locale: string | undefined
): Promise<Awaited<ReturnType<typeof readNamedList>> | undefined> {
  const base = namedListBase(props);
  if (base === undefined || "blocking" in base) return undefined;
  const ctx = createStandaloneContext({
    namedQueries: host,
    queries: createQueryBudget(),
    ...(locale === undefined ? {} : { locale }),
  });
  return await readNamedList(
    base.named,
    { limit: base.limit, offset: base.offset },
    { ...ctx, namedQueries: host },
    "count"
  );
}

/** The canvas's custom sources in one language, read once and shared. */
export interface CanvasNamedQueries {
  /** The site's custom sources, one read shared by the menu and the canvas. */
  readonly sources: () => Promise<readonly CanvasCustomSource[]>;
  /** The host the canvas draws named lists with, once the sources are read. */
  readonly host: () => Promise<NamedQueryHost>;
  /** The count of a named list, from the canvas's own runs. */
  readonly count: (
    props: Readonly<Record<string, unknown>>
  ) => Promise<ListEntryCount | undefined>;
  /** How many rows a named list draws, from the canvas's own runs. */
  readonly shown: (
    props: Readonly<Record<string, unknown>>
  ) => Promise<number | undefined>;
}

/** One set per language, shared by the canvas and the inspector. */
const BY_LANGUAGE = new Map<string, CanvasNamedQueries>();
/** The person whose runs `BY_LANGUAGE` holds, so another's are dropped first. */
let runsFor: string | null | undefined;

/**
 * The canvas's custom sources for `userId`, the signed-in person, in
 * `locale`, the language being edited: one object per person and language,
 * so the Source menu, the canvas and the count share one read of the
 * sources and one set of kept runs. A run reads as the person signed in, so
 * the moment another person asks, every earlier person's runs are dropped
 * before anything is answered, as the canvas's list reads are. A failed read
 * of the sources is not kept, so the next asks again.
 *
 * With `visitor`, the document being edited, each run is made as a visitor
 * of that document makes it, kept apart from the person's own runs.
 */
export function canvasNamedQueriesIn(
  locale: string | undefined,
  userId: string | null,
  visitor?: ListEntriesVisitor
): CanvasNamedQueries {
  if (runsFor !== userId) {
    BY_LANGUAGE.clear();
    runsFor = userId;
  }
  const key = JSON.stringify([
    locale ?? "",
    visitor?.collection ?? null,
    visitor?.id ?? null,
  ]);
  const known = BY_LANGUAGE.get(key);
  if (known !== undefined) return known;
  const runs = canvasNamedRuns(
    visitor === undefined
      ? runThrough
      : body => runThrough({ ...body, visitor })
  );
  let read: Promise<readonly CanvasCustomSource[]> | undefined;
  const sources = () => {
    if (read === undefined) {
      const reading = listCustomSources(locale);
      read = reading;
      reading.catch(() => {
        if (read === reading) read = undefined;
      });
    }
    return read;
  };
  // One host per read of the sources, so the canvas's context, which holds
  // it, stays one object until the sources are read again.
  const hosts = new WeakMap<
    Promise<readonly CanvasCustomSource[]>,
    Promise<NamedQueryHost>
  >();
  const host = () => {
    const reading = sources();
    let made = hosts.get(reading);
    if (made === undefined) {
      made = reading.then(found => canvasNamedHost(found, runs, locale));
      hosts.set(reading, made);
    }
    return made;
  };
  const made: CanvasNamedQueries = {
    sources,
    host,
    count: async props => namedListCount(props, await host(), locale),
    shown: async props => namedListShown(props, await host(), locale),
  };
  BY_LANGUAGE.set(key, made);
  return made;
}
