/**
 * Keeping the "Bindings to fix" report current: a document is judged again
 * after each write to it, and every document when the schema it is judged
 * against changes.
 *
 * A document is judged as stored, each blocks field in each language it
 * stores, read through the same walk the check of every document reads, and
 * composed with the components it places: a placed component's bindings to
 * the entry read the entry of the page placing it, so they are judged there,
 * against it.
 *
 * Nothing tells a plugin that a collection's fields, a Single's fields or a
 * block's props changed, so the check of every document compares a
 * fingerprint of all three with the one the last complete check was made
 * against. It runs as a sweep job, a jobs pass at a time, and resumes where a
 * pass stopped. What it records is fenced by when it read each document, so
 * a save judged since is never replaced by what the check read before it. A
 * document deleted since is dropped when a complete check finds it gone.
 *
 * A write does not judge its document there and then: it marks the document's
 * row dirty and starts the sweep, which judges dirty documents one at a time
 * and settles each only while its mark is the one it read. Two writes close
 * together, a judgement that failed, or a source whose fields could not be
 * read, each leave the row dirty to be judged again on the next pass, rather
 * than an older answer kept.
 *
 * Judged as the system: the report says what is broken; who may see each row
 * is the route's question.
 *
 * @module bindings-report/scan
 */
import {
  isPlainRecord,
  walkNodes,
  type BindingSchemaRef,
  type BlockDocument,
  type DocumentLimits,
  type ResolvedBlockNode,
  type NamedQuerySource,
} from "@nextlyhq/blocks-engine";
import type { HookContext } from "@nextlyhq/plugin-sdk";

import { asDocument } from "../component-store-source";
import {
  composeWithReads,
  documentReader,
  heldLibrary,
  type ComponentSource,
} from "../composition-reading";
import type { DeclaredShapesReader } from "../fields/binding-judgement";
import { placedComponents } from "../fields/list-query-judgement";
import { hookDocumentOf } from "../host-rewrite/after-commit";
import { documentKeyOf, type HostAddress } from "../host-rewrite/contract";
import type {
  HostCandidate,
  HostDocument,
  HostReader,
  ReadValue,
} from "../host-rewrite/rewrite";

import { documentBindingReport, type BindingReportRow } from "./rows";
import type {
  BindingReportStore,
  DirtyDocument,
  ReportedDocument,
} from "./store";

/** How the report reads a document as stored. */
export interface DocumentReading {
  /** The document's hosts: each blocks field in each language it stores. */
  readonly hostsOf: (
    at: Pick<HostAddress, "kind" | "slug" | "id">
  ) => Promise<readonly HostCandidate[]>;
  readonly read: HostReader;
  /** The components a document places, as visitors are served them. */
  readonly components?: ComponentSource;
  /**
   * The Layout a page is drawn in, as visitors are served it, whose regions'
   * bindings read the page's entry; `undefined` for a document drawn in none.
   */
  readonly layoutOf?: (
    at: Pick<HostAddress, "kind" | "slug" | "id">
  ) => Promise<{ readonly id: string; readonly value: unknown } | undefined>;
}

/** What keeping the report needs of the installed plugin. */
export interface BindingReportDeps {
  /** The report's store; `null` before the plugin's tables are ready. */
  readonly store: () => BindingReportStore | null;
  /** How documents are read; `null` before the plugin is installed. */
  readonly reading: () => DocumentReading | null;
  readonly shapesOf: DeclaredShapesReader;
  readonly limits: () => DocumentLimits;
  /** Where a document lives: pages, components, patterns, layouts, entries or singles. */
  readonly placeOf: (at: Pick<HostAddress, "kind" | "slug">) => string;
  /** Start the sweep, without waiting for it; nothing where none can run. */
  readonly kick?: () => void;
  /** The site's named queries, whose rows a list's item bindings read. */
  readonly namedQueries?: NamedQuerySource;
}

/** A document's entry, as its bindings read it; none for a component's own. */
function entryRef(
  at: Pick<HostAddress, "kind" | "slug">,
  document: unknown
): BindingSchemaRef | undefined {
  if (isPlainRecord(document) && document.kind === "component") {
    return undefined;
  }
  return at.kind === "collection"
    ? { collection: at.slug }
    : { single: at.slug };
}

/**
 * A document with the components it places expanded, and which composed
 * block each placement put there. The document as stored where it places
 * none, or where no component can be read.
 */
async function composedWith(
  document: BlockDocument,
  deps: Pick<BindingReportDeps, "limits">,
  components: ComponentSource | undefined
): Promise<{
  readonly document: BlockDocument;
  readonly placedBy: ReadonlyMap<string, string>;
  /** Whether a component could not be read, or a limit ended the expansion. */
  readonly incomplete: boolean;
}> {
  if (components === undefined) {
    return { document, placedBy: new Map(), incomplete: false };
  }
  const limits = deps.limits();
  const composed = await composeWithReads({
    host: document,
    library: heldLibrary(),
    read: documentReader(components, false),
    limits,
    work: { left: limits.maxNodes },
  });
  const expanded = composed.composition.document;
  const placedBy = new Map<string, string>();
  walkNodes(
    expanded.nodes,
    node => {
      const through = (node as ResolvedBlockNode).instanceOf;
      if (typeof through === "string") placedBy.set(node.id, through);
    },
    { maxNodes: limits.maxNodes }
  );
  return {
    document: expanded,
    placedBy,
    incomplete: composed.incomplete || composed.stoppedShort,
  };
}

/**
 * The report's rows for one stored blocks value: its own blocks, its
 * metadata, and the blocks its placed components bring, each of those named
 * by the placement it came through and the component placed there.
 */
async function valueRows(
  entryOf: Pick<HostAddress, "kind" | "slug">,
  value: unknown,
  deps: Pick<BindingReportDeps, "shapesOf" | "limits" | "namedQueries">,
  components: ComponentSource | undefined
): Promise<{
  readonly rows: BindingReportRow[];
  readonly incomplete: boolean;
}> {
  const stored = asDocument(value);
  if (stored === null) return { rows: [], incomplete: false };
  const composed = await composedWith(stored, deps, components);
  const { document, placedBy } = composed;
  const report = await documentBindingReport(
    { nodes: document.nodes, settings: stored.settings },
    entryRef(entryOf, stored),
    {
      shapesOf: deps.shapesOf,
      maxNodes: deps.limits().maxNodes,
      ...(deps.namedQueries === undefined
        ? {}
        : { namedQueries: deps.namedQueries }),
    }
  );
  const componentOf = placedComponents(stored, deps.limits().maxNodes);
  const rows = report.rows.map(row => {
    const placement = placedBy.get(row.nodeId);
    if (placement === undefined) return row;
    const component = componentOf.get(placement);
    return {
      ...row,
      nodeId: placement,
      ...(component === undefined ? {} : { component }),
    };
  });
  // A composition read in part may lack a placed component's problem, so it
  // is judged again rather than recorded as whole.
  return { rows, incomplete: report.incomplete || composed.incomplete };
}

/** A read's value, or nothing for an absent one. */
function valueOf(read: ReadValue | null): unknown {
  return read !== null && read.kind === "value" ? read.value : undefined;
}

/**
 * The report's rows for one document as stored: each host's working form
 * (the draft where there is one, which an author fixes, else the live value),
 * each row naming the field and language it is in, and the regions of the
 * Layout a page is drawn in, judged against the page's entry. A value read
 * once per language because which fields store per language is unknown is
 * judged once.
 */
async function documentRows(
  at: Pick<HostAddress, "kind" | "slug" | "id">,
  hosts: readonly HostCandidate[],
  deps: Pick<BindingReportDeps, "shapesOf" | "limits" | "namedQueries">,
  reading: DocumentReading
): Promise<{
  readonly rows: BindingReportRow[];
  readonly incomplete: boolean;
}> {
  const rows: BindingReportRow[] = [];
  let incomplete = false;
  const shared = new Set<string>();
  for (const candidate of hosts) {
    const judged = await hostRows(candidate, shared, deps, reading);
    incomplete ||= judged.incomplete;
    rows.push(...judged.rows);
  }
  const layout = await reading.layoutOf?.(at);
  if (layout !== undefined) {
    const judged = await valueRows(at, layout.value, deps, reading.components);
    incomplete ||= judged.incomplete;
    for (const row of judged.rows) {
      rows.push({ ...row, layout: layout.id, blocksField: "layout" });
    }
  }
  return { rows, incomplete };
}

/**
 * One host's rows, named by its field and language. A value read once per
 * language because which fields store per language is unknown is judged the
 * first time only (`shared` holds those judged).
 */
async function hostRows(
  { host, access, maybeShared }: HostCandidate,
  shared: Set<string>,
  deps: Pick<BindingReportDeps, "shapesOf" | "limits" | "namedQueries">,
  reading: DocumentReading
): Promise<{
  readonly rows: BindingReportRow[];
  readonly incomplete: boolean;
}> {
  // A host searched row by row (a blocks field inside a repeater) is not one
  // document the report can point an author at; it is left out.
  if (access === "scan") return { rows: [], incomplete: false };
  let read;
  try {
    read = await reading.read(host);
  } catch {
    // Not read is not judged: a read that failed (the database, or a value
    // that kept changing while it was read) leaves the document marked, so
    // its last verdict stands until a later pass reads it.
    return { rows: [], incomplete: true };
  }
  const value = valueOf(read.draft) ?? valueOf(read.published);
  if (value === undefined) return { rows: [], incomplete: false };
  const field = host.path.join(".");
  if (maybeShared === true) {
    const seen = `${field}\u0000${JSON.stringify(value)}`;
    if (shared.has(seen)) return { rows: [], incomplete: false };
    shared.add(seen);
  }
  const perLanguage = host.locale !== undefined && maybeShared !== true;
  const judged = await valueRows(host, value, deps, reading.components);
  return {
    incomplete: judged.incomplete,
    rows: judged.rows.map(row => ({
      ...row,
      blocksField: field,
      ...(perLanguage ? { locale: host.locale } : {}),
    })),
  };
}

/** Which document a key names, and where it lives, for its row. */
function reported(
  at: Pick<HostAddress, "kind" | "slug" | "id">,
  deps: Pick<BindingReportDeps, "placeOf">
): ReportedDocument {
  return {
    documentKey: documentKeyOf(at),
    kind: at.kind,
    slug: at.slug,
    ...(at.id === undefined ? {} : { documentId: at.id }),
    place: deps.placeOf(at),
  };
}

/** The plugin capabilities recording on write needs, named structurally. */
export interface BindingReportHooksContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
  logger: { error(message: string, meta?: Record<string, unknown>): void };
}

/** Which document a committed write or delete is to, and what it held. */
function hookedDocument(context: unknown):
  | {
      readonly collection: string;
      readonly data: Record<string, unknown>;
      readonly at: NonNullable<ReturnType<typeof hookDocumentOf>>;
    }
  | undefined {
  const fields = context as { collection?: unknown; data?: unknown };
  if (typeof fields.collection !== "string" || !isPlainRecord(fields.data)) {
    return undefined;
  }
  const at = hookDocumentOf(fields.collection, fields.data);
  return at === undefined
    ? undefined
    : { collection: fields.collection, data: fields.data, at };
}

/**
 * Whether a written document may hold a blocks value: one at its top level,
 * or any blocks field its declaration has, nested ones included, as the walk
 * lists them.
 */
async function mayHoldBlocks(
  written: NonNullable<ReturnType<typeof hookedDocument>>,
  deps: BindingReportDeps
): Promise<boolean> {
  if (holdsBlocks(written.data)) return true;
  const reading = deps.reading();
  if (reading === null) return false;
  return (await reading.hostsOf(written.at)).length > 0;
}

/** Whether a write's data holds a blocks value at its top level. */
function holdsBlocks(data: Record<string, unknown>): boolean {
  return Object.values(data).some(value => asDocument(value) !== null);
}

/**
 * Mark each written or deleted document to be judged again, and start the
 * sweep that judges it. A write to a document whose declaration holds no
 * blocks field marks nothing. After commit; a failure is logged,
 * never thrown, since the write has committed.
 */
export function registerBindingReportOnWrite(
  ctx: BindingReportHooksContext,
  deps: BindingReportDeps
): void {
  const mark = async (context: unknown, always: boolean): Promise<void> => {
    const written = hookedDocument(context);
    const store = deps.store();
    if (written === undefined || store === null) return;
    const document = reported(written.at, deps);
    const report = async (): Promise<void> => {
      try {
        if (!always && !(await mayHoldBlocks(written, deps))) return;
        await store.markDirty(document);
        deps.kick?.();
      } catch (error) {
        ctx.logger.error(
          `[page-builder] a write to "${written.collection}" was not marked for the bindings report; it is judged again when the schema next changes.`,
          { collection: written.collection, error }
        );
      }
    };
    // A write inside a caller's transaction runs its after-hooks before that
    // transaction commits: the hook context's `afterCommit` holds the mark
    // until the outermost one commits (and drops it on a rollback), so the
    // declaration read and the mark take a pooled connection the save no
    // longer holds, rather than one a save holding the pool's last
    // connection would wait for until the pool's wait runs out. Outside a
    // transaction it runs at once.
    const { afterCommit } = context as Pick<HookContext, "afterCommit">;
    await (afterCommit ? afterCommit(report) : report());
  };
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    ctx.hooks.on(phase, "*", context => mark(context, false));
  }
  ctx.hooks.on("afterDelete", "*", context => mark(context, true));
}

/** How many marked documents one read of them takes. */
const DIRTY_BATCH = 50;

/**
 * Judge the documents writes marked, until none is left or `deadline`. Each
 * is settled only while its mark is the one read; one whose judgement could
 * not read a source is left marked, and not asked again this pass.
 */
async function settleDirty(
  store: BindingReportStore,
  deps: BindingReportDeps,
  reading: DocumentReading,
  deadline: Date
): Promise<boolean> {
  // A cursor over the marked keys: each is tried once a pass, and one left
  // marked (its judgement incomplete) is not read again until the next.
  let after: string | undefined;
  for (;;) {
    const batch = await store.dirty(DIRTY_BATCH, after);
    if (batch.length === 0) return true;
    for (const marked of batch) {
      if (Date.now() >= deadline.getTime()) return false;
      after = marked.document.documentKey;
      await settleOne(marked, store, deps, reading);
    }
  }
}

/** Judge one marked document as stored, and settle it if the judgement is whole. */
async function settleOne(
  marked: DirtyDocument,
  store: BindingReportStore,
  deps: BindingReportDeps,
  reading: DocumentReading
): Promise<void> {
  const { kind, slug, documentId } = marked.document;
  const at = {
    kind,
    slug,
    ...(documentId === undefined ? {} : { id: documentId }),
  };
  const hosts = await reading.hostsOf(at);
  // A document gone, or holding no blocks field any more, has nothing.
  const judged =
    hosts.length === 0
      ? { rows: [], incomplete: false }
      : await documentRows(at, hosts, deps, reading);
  if (!judged.incomplete) await store.settle(marked, judged.rows);
}

/** What the check of every document walks the site with. */
export interface FullCheckSite {
  /** Every document holding blocks, after a cursor, in a stable order. */
  readonly documents: (cursor: string | null) => AsyncIterable<HostDocument>;
  readonly cursorOf: (document: HostDocument) => string;
  /** The fingerprint of the schema documents are judged against now. */
  readonly fingerprint: () => Promise<string>;
}

/** How a pass of the check of every document ended. */
export type FullCheckOutcome = "current" | "paused" | "complete";

/**
 * One document judged and recorded; one whose judgement could not read a
 * source is marked to be judged again instead of recorded as it was found.
 */
async function checkDocument(
  document: HostDocument,
  store: BindingReportStore,
  deps: BindingReportDeps,
  reading: DocumentReading
): Promise<void> {
  const first = document.hosts[0]?.host;
  if (first === undefined) return;
  const judged = await documentRows(first, document.hosts, deps, reading);
  if (judged.incomplete) await store.markDirty(reported(first, deps));
  else await store.record(reported(first, deps), judged.rows);
}

/**
 * One pass of the sweep: first the documents writes marked; then, the check
 * of every document: nothing when the schema has not changed since the last
 * complete check; else it judges documents from where
 * the last pass stopped until `deadline`, and records where it stopped. A
 * complete check records the fingerprint it was made against, and when, and
 * drops the rows of documents it no longer found.
 */
export async function runFullCheck(
  site: FullCheckSite,
  deps: BindingReportDeps,
  deadline: Date
): Promise<FullCheckOutcome> {
  const store = deps.store();
  const reading = deps.reading();
  if (store === null || reading === null) return "paused";
  if (!(await settleDirty(store, deps, reading, deadline))) return "paused";
  const fingerprint = await site.fingerprint();
  const state = await store.fullCheck();
  if (state.checked === fingerprint && state.checking === null) {
    return "current";
  }
  // A check for another fingerprint starts over: the schema changed under it.
  const resuming = state.checking === fingerprint;
  const startedAt =
    resuming && state.startedAt !== null ? state.startedAt : new Date();
  let cursor = resuming ? state.cursor : null;
  const progress = () => ({
    checked: state.checked,
    completedAt: state.completedAt,
    checking: fingerprint,
    cursor,
    startedAt,
  });
  await store.setFullCheck(progress());
  for await (const document of site.documents(cursor)) {
    if (Date.now() >= deadline.getTime()) {
      await store.setFullCheck(progress());
      return "paused";
    }
    await checkDocument(document, store, deps, reading);
    cursor = site.cursorOf(document);
  }
  // Every document still on the site was judged since the check started, so a
  // row older than that is a document no longer there.
  await store.dropCheckedBefore(startedAt);
  await store.setFullCheck({
    checked: fingerprint,
    completedAt: new Date(),
    checking: null,
    cursor: null,
    startedAt: null,
  });
  return "complete";
}
