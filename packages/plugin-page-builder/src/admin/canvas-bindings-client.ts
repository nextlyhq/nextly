"use client";

/**
 * The canvas's binding sources: what the bound props on the page being edited
 * read, read through the canvas bindings route as the person editing reads
 * them, and handed to the renderer as `PageBindings`.
 *
 * The canvas works out what its bindings read from the document it draws
 * (`bindingDemand`, the published page's own walk) and asks only for that,
 * so a page with no binding asks nothing. Asked again only when what the
 * bindings read changes, not on every keystroke, and kept a few seconds so
 * the page drawn again for a selection does not read again.
 *
 * Kept per signed-in person: the values are theirs, drafts included, so the
 * moment another person asks in the same tab (a sign-out and a sign-in),
 * every earlier person's kept reads are dropped before anything is answered.
 *
 * @module canvas-bindings-client
 */
import {
  bindingDemand,
  conditionDemand,
  conditionOp,
  isPlainRecord,
  type BindingDemand,
  type BlockDocument,
  type ConditionDemand,
} from "@nextlyhq/blocks-engine";
import {
  bindingsFromWire,
  listCollections,
  READ_KINDS,
  type NamedQueryLookup,
  type PageBindings,
  type PageReadReport,
  type ReadKind,
} from "@nextlyhq/blocks-react";
import {
  useCurrentUserId,
  writePluginRoute,
  type DocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CANVAS_BINDINGS_ROUTE_PATH,
  conditionsToWire,
  demandToWire,
  type CanvasBindingsRequest,
  type CanvasBindingsResponse,
} from "../canvas-bindings-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import {
  useCanvasEntryIdentity,
  useCanvasEntryRead,
  type CanvasEntryRead,
} from "./editor/canvas-entry";
/**
 * What each answer's reads cost the page's allowance, by the bindings it
 * gave, so the editor's read meter adds the binding reads as the route made
 * them. Kept beside the answer rather than in it, so every reader of the
 * bindings keeps the shape it always had.
 */
const READS = new WeakMap<PageBindings, PageReadReport>();

/** What reading these bindings cost, when the route said; none for none read. */
export function bindingReadsOf(
  bindings: PageBindings
): PageReadReport | undefined {
  return READS.get(bindings);
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<ReadKind>(READ_KINDS);

/** Whether a name is one of the kinds a budget counts. */
function isReadKind(name: string): name is ReadKind {
  return KNOWN_KINDS.has(name);
}

/** A count the route sent: a whole number, not below zero. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The reads an answer reports, when they are what a budget reports: checked
 * here, at the boundary, since the answer arrives over the network. An answer
 * without them, or with anything else in their place, reports none.
 */
function readsIn(answer: unknown): PageReadReport | undefined {
  const reads = isPlainRecord(answer) ? answer.reads : undefined;
  if (!isPlainRecord(reads)) return undefined;
  const { cap, used, refused, unread } = reads;
  if (!isCount(used) || !isCount(refused)) return undefined;
  if (typeof cap !== "number" || !Array.isArray(unread)) return undefined;
  const byKind = kindsIn(reads.byKind);
  // The route reads no block's data, so it names none.
  return byKind === undefined
    ? undefined
    : { cap, used, refused, byKind, unread: [] };
}

/** A report's reads by kind, when each is a kind with a count. */
function kindsIn(
  byKind: unknown
): Partial<Record<ReadKind, number>> | undefined {
  if (!isPlainRecord(byKind)) return undefined;
  const kinds: Partial<Record<ReadKind, number>> = {};
  for (const [kind, count] of Object.entries(byKind)) {
    if (!isReadKind(kind) || !isCount(count)) return undefined;
    kinds[kind] = count;
  }
  return kinds;
}

/** No source read: what the canvas draws with until an answer arrives. */
const NONE: PageBindings = Object.freeze({});

/** How long an answer is kept for the same ask. */
const KEPT_FOR_MS = 15_000;

/** The asks answered so far, by ask, for the current person only. */
const KEPT = new Map<string, { at: number; read: Promise<PageBindings> }>();
/**
 * The person whose answers `KEPT` holds. Always a known person: until the
 * signed-in person is known nothing is asked, so no answer is ever kept under
 * an identity two people could share.
 */
let keptFor: string | undefined;

/**
 * What a page's conditions ask of the canvas's reads, or nothing when it
 * holds none: nothing of the entry, but the public field shapes of the lists
 * it draws, which a block a list's item decides is judged by while
 * conditions are applied, though nothing binds; and the site's time zone
 * where any condition orders a value, which may compare days, so the canvas
 * judges a day as the published page does.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function listConditionsFor(
  nodes: readonly unknown[]
): ConditionDemand | undefined {
  if (!conditionDemand(nodes).any) return undefined;
  const ordersValues = ordersAnyValue(nodes);
  return {
    any: true,
    entryFields: new Set<string>(),
    ordersValues,
    orderedFields: new Set<string>(),
  };
}

/** The operators that order a value, so may compare days. */
const ORDERING: ReadonlySet<string> = new Set(["greater_than", "less_than"]);

/** Whether any block's stored conditions order a value, of any scope. */
function ordersAnyValue(nodes: readonly unknown[]): boolean {
  const stack: unknown[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isPlainRecord(node)) continue;
    if (conditionsOf(node.visibility).some(op => ORDERING.has(op))) {
      return true;
    }
    if (isPlainRecord(node.slots)) {
      for (const children of Object.values(node.slots)) {
        if (Array.isArray(children)) stack.push(...(children as unknown[]));
      }
    }
  }
  return false;
}

/**
 * The operators a stored visibility's conditions use, read as the engine
 * reads them, so a stored alias (`gt`, `lt`) is the operator it stands for.
 */
function conditionsOf(visibility: unknown): string[] {
  if (!isPlainRecord(visibility) || !Array.isArray(visibility.conditions)) {
    return [];
  }
  return (visibility.conditions as unknown[]).flatMap(group =>
    Array.isArray(group) ? (group as unknown[]).flatMap(canonicalOp) : []
  );
}

/** One stored condition's operator as the engine reads it, if it reads one. */
function canonicalOp(condition: unknown): string[] {
  const op = isPlainRecord(condition) ? conditionOp(condition.op) : undefined;
  return op === undefined ? [] : [op];
}

/**
 * What the canvas asks for the page it draws, or nothing when it holds no
 * binding or has no entry to read for.
 *
 * `drawn` is every tree the canvas draws, the page's and each Layout
 * region's, prepared by the renderer's own pipeline
 * (`prepareDocumentForRead`): a component's bound nodes and its lists are in
 * them, where a stored document holds only the component's instance. The
 * published route reads for the page and its regions together, and so does
 * this.
 *
 * A component's own document has no entry of its own: a placed component
 * reads the entry of each page placing it, so its preview asks for none
 * rather than reading the component's storage row as one.
 */
export function canvasBindingsRequest(
  drawn: readonly BlockDocument[],
  identity: DocumentIdentity | null,
  locale: string | undefined,
  component = false,
  /**
   * The site's named queries: a list whose source is one whose rows are a
   * collection's entries asks for that collection's field shapes too, as
   * the published page does.
   */
  namedQueries?: NamedQueryLookup,
  /**
   * For the editor's read meter, which reads as the published page does:
   * what the page's conditions read, and the reads the page has left.
   */
  reads: {
    readonly conditions?: ConditionDemand;
    readonly allowance?: number;
  } = {}
): CanvasBindingsRequest | undefined {
  if (identity === null || drawn.length === 0) return undefined;
  const found = bindingDemand(drawn);
  // Conditions that restrict anybody read for the page as its bindings do,
  // as the published page's read takes them in.
  const conditions =
    reads.conditions?.any === true ? reads.conditions : undefined;
  const demand: BindingDemand = component
    ? {
        any: found.any,
        singles: found.singles,
        site: found.site,
        formatsDates: found.formatsDates,
      }
    : found;
  const lists = [...listCollections(drawn, namedQueries)].sort();
  const wire = demandToWire(demand);
  const asks =
    wire.entry !== undefined ||
    Object.keys(wire.singles).length > 0 ||
    wire.site ||
    wire.formatsDates ||
    lists.length > 0 ||
    conditions !== undefined;
  if (!(found.any || conditions !== undefined) || !asks) return undefined;
  return {
    source: requestSourceOf(identity),
    demand: wire,
    lists,
    ...(locale === undefined ? {} : { locale }),
    ...(conditions === undefined
      ? {}
      : { conditions: conditionsToWire(conditions) }),
    // A whole number of reads the route can be asked for; none past it.
    ...(reads.allowance === undefined || !Number.isFinite(reads.allowance)
      ? {}
      : { allowance: Math.max(0, Math.floor(reads.allowance)) }),
  };
}

/** The entry an ask is made for, as the route takes it. */
function requestSourceOf(
  identity: DocumentIdentity
): CanvasBindingsRequest["source"] {
  return {
    kind: identity.kind,
    slug: identity.slug,
    ...(identity.documentId === undefined ? {} : { id: identity.documentId }),
  };
}

/** The site's zone read so far, by editor session, for the person it was read as. */
const ZONES = new WeakMap<
  object,
  { readonly userId: string; readonly read: Promise<string | undefined> }
>();

/**
 * The site's time zone, as a published page shows its date-times in it, for
 * the inspector's previews: read once per editor session (`session`, any
 * object that lives as long as one editor) and person, and only when asked.
 *
 * Asked of the route as a page that formats a date and binds nothing else,
 * so the route reads the zone by the published page's own rule
 * (`readBindingSources`, which reads the site settings for it) and nothing
 * more. A page that formats no date asks the canvas's read for no zone, so
 * the inspector cannot take it from there. A failed read is not kept, so
 * the next ask reads again; `undefined` is a site with no zone set.
 */
export function siteTimeZoneFor(
  session: object,
  identity: DocumentIdentity,
  userId: string,
  ask: (
    request: CanvasBindingsRequest
  ) => Promise<CanvasBindingsResponse> = askRoute
): Promise<string | undefined> {
  const kept = ZONES.get(session);
  if (kept !== undefined && kept.userId === userId) return kept.read;
  const request: CanvasBindingsRequest = {
    source: requestSourceOf(identity),
    demand: demandToWire({
      any: true,
      singles: new Map(),
      site: false,
      formatsDates: true,
    }),
    lists: [],
  };
  const read = ask(request).then(answer => bindingsFromWire(answer).timeZone);
  ZONES.set(session, { userId, read });
  read.catch(() => {
    if (ZONES.get(session)?.read === read) ZONES.delete(session);
  });
  return read;
}

/** One ask of the route. */
async function askRoute(
  request: CanvasBindingsRequest,
  signal?: AbortSignal
): Promise<CanvasBindingsResponse> {
  const body = await writePluginRoute<CanvasBindingsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: CANVAS_BINDINGS_ROUTE_PATH,
    method: "POST",
    body: request,
    ...(signal === undefined ? {} : { signal }),
  });
  if (body === undefined || !Array.isArray(body.singles)) {
    throw new Error("The canvas's binding sources could not be read.");
  }
  return body;
}

/**
 * The sources an ask names, for `userId`: from the answers kept for that
 * person, or asked afresh. Another person's answers are dropped first.
 * `fresh` asks afresh whatever is kept, for a read the editor asks again
 * (a retry, the window back in focus), so what was kept never answers it.
 */
export function canvasBindingsFor(
  request: CanvasBindingsRequest,
  userId: string,
  ask: (
    request: CanvasBindingsRequest,
    signal?: AbortSignal
  ) => Promise<CanvasBindingsResponse> = askRoute,
  fresh = false,
  /**
   * Aborts the ask this call makes. An aborted ask fails, and like any
   * failed ask is not kept, so the next ask for the same sources is made
   * afresh.
   */
  signal?: AbortSignal
): Promise<PageBindings> {
  if (signal?.aborted === true) {
    return Promise.reject(signal.reason as Error);
  }
  if (keptFor !== userId) {
    KEPT.clear();
    keptFor = userId;
  }
  const key = JSON.stringify(request);
  const kept = KEPT.get(key);
  if (!fresh && kept !== undefined && Date.now() - kept.at < KEPT_FOR_MS) {
    return kept.read;
  }
  const reading = ask(request, signal).then(answer => {
    const bindings = bindingsFromWire(answer);
    const reads = readsIn(answer);
    if (reads !== undefined) READS.set(bindings, reads);
    return bindings;
  });
  KEPT.set(key, { at: Date.now(), read: reading });
  // A failed ask is not kept, so the next draw asks again.
  reading.catch(() => {
    if (KEPT.get(key)?.read === reading) KEPT.delete(key);
  });
  return reading;
}

/**
 * Where the canvas's read of ask `key` stands: not needed (nothing bound),
 * answered for this person, failed, or on its way.
 */
function readStateOf(
  key: string,
  answer: {
    readonly key: string;
    readonly userId: string;
    readonly retry: number;
  } | null,
  failed: string | null,
  userId: string | null,
  retry: number
): CanvasEntryRead["state"] {
  if (key === "") return "none";
  // Answered for THIS ask and this retry: a retry the editor asks for (the
  // window back in focus) is pending until its own answer arrives, so the
  // strip never names a refreshed entry over the bindings read before it.
  if (
    answer !== null &&
    answer.key === key &&
    answer.userId === userId &&
    answer.retry === retry
  ) {
    return "answered";
  }
  return failed === key ? "failed" : "pending";
}

/**
 * The binding sources the canvas draws a page with, as the person editing
 * reads them. `drawn` is every tree the canvas draws, and `component` says
 * the document is a component's own (see {@link canvasBindingsRequest}).
 *
 * Until the first answer arrives, for a page with no binding, and while the
 * signed-in person is not yet known, no source is read: bound props keep
 * their own values or fallbacks, as the canvas always drew them. While a
 * changed ask is answered, the previous answer is kept, so bound values do
 * not blink to their fallbacks; when the changed ask fails, the previous
 * answer goes and the fallbacks are drawn.
 */
export function useCanvasBindings(
  drawn: readonly BlockDocument[],
  locale: string | undefined,
  component = false,
  /** The site's named queries, once the canvas has read them. */
  namedQueries?: NamedQueryLookup,
  /** What the page's conditions ask of the reads, where it holds any. */
  conditions?: ConditionDemand
): PageBindings {
  // The entry the canvas is drawn as: the document's own, or a template's
  // previewed entry of the collection it draws.
  const identity = useCanvasEntryIdentity();
  // A retry the editor asks for, and where it hears how this read stands.
  const { retry, onRead } = useCanvasEntryRead();
  const userId = useCurrentUserId();
  const request = useMemo(
    () =>
      canvasBindingsRequest(
        drawn,
        identity,
        locale,
        component,
        namedQueries,
        conditions === undefined ? {} : { conditions }
      ),
    [drawn, identity, locale, component, namedQueries, conditions]
  );
  // The ask as text: a new document that asks the same reads nothing new.
  const key = request === undefined ? "" : JSON.stringify(request);
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly userId: string;
    readonly bindings: PageBindings;
    /** The retry this answer is for. */
    readonly retry: number;
  } | null>(null);
  // The ask that failed last, so its failure is told rather than taken for
  // an answer on its way.
  const [failed, setFailed] = useState<string | null>(null);
  // Bumped once an answer has been kept its while, so the same ask is made
  // again: a source can change while what the page asks stays the same (a
  // saved title, an updated Single).
  const [round, setRound] = useState(0);
  // The retry this read last answered, so a retry the editor asks for reads
  // afresh rather than from what was kept for the same ask.
  const answeredRetry = useRef(retry);
  useEffect(() => {
    // The route answers whoever the session cookie names, so an answer is
    // only asked for, and kept, under a person known by id.
    if (key === "" || userId === null) return;
    const fresh = answeredRetry.current !== retry;
    answeredRetry.current = retry;
    let current = true;
    let stale: ReturnType<typeof setTimeout> | undefined;
    // Asked again, so an earlier failure of this ask is no longer the answer.
    setFailed(previous => (previous === key ? null : previous));
    // Asked again when the editor is back in sight, never while it is not.
    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", onVisible);
      setRound(value => value + 1);
    };
    const askAgain = () => {
      if (!current) return;
      if (document.visibilityState === "hidden") {
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      setRound(value => value + 1);
    };
    canvasBindingsFor(
      JSON.parse(key) as CanvasBindingsRequest,
      userId,
      askRoute,
      fresh
    ).then(
      bindings => {
        if (!current) return;
        setAnswer({ key, userId, bindings, retry });
        setFailed(null);
        stale = setTimeout(askAgain, KEPT_FOR_MS);
      },
      () => {
        // The sources could not be read: bound props keep their own values
        // or fallbacks, as before any answer. The previous ask's answer is
        // dropped too, or the canvas would go on drawing another locale's or
        // another page's values as this one's.
        if (!current) return;
        setAnswer(null);
        setFailed(key);
      }
    );
    return () => {
      current = false;
      if (stale !== undefined) clearTimeout(stale);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, userId, round, retry]);
  // Where this read stands, told to the editor that gave the entry, so what
  // it says the canvas shows is what the canvas shows.
  const state = readStateOf(key, answer, failed, userId, retry);
  const entryId = identity?.documentId;
  useEffect(() => {
    onRead?.({ entryId, state });
  }, [onRead, entryId, state]);
  // Never another person's answer, none for an unknown person, and nothing
  // for a page with no binding.
  if (key === "" || answer === null || answer.userId !== userId) return NONE;
  return answer.bindings;
}
