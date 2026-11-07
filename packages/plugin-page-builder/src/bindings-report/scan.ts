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
} from "@nextlyhq/blocks-engine";

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
import type { BindingReportStore, ReportedDocument } from "./store";

/** How the report reads a document as stored. */
export interface DocumentReading {
  /** The document's hosts: each blocks field in each language it stores. */
  readonly hostsOf: (
    at: Pick<HostAddress, "kind" | "slug" | "id">
  ) => Promise<readonly HostCandidate[]>;
  readonly read: HostReader;
  /** The components a document places, as visitors are served them. */
  readonly components?: ComponentSource;
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
}> {
  if (components === undefined) return { document, placedBy: new Map() };
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
  return { document: expanded, placedBy };
}

/**
 * The report's rows for one stored blocks value: its own blocks, its
 * metadata, and the blocks its placed components bring, each of those named
 * by the placement it came through and the component placed there.
 */
async function valueRows(
  at: Pick<HostAddress, "kind" | "slug">,
  value: unknown,
  deps: Pick<BindingReportDeps, "shapesOf" | "limits">,
  components: ComponentSource | undefined
): Promise<BindingReportRow[]> {
  const stored = asDocument(value);
  if (stored === null) return [];
  const { document, placedBy } = await composedWith(stored, deps, components);
  const report = await documentBindingReport(
    { nodes: document.nodes, settings: stored.settings },
    entryRef(at, stored),
    { shapesOf: deps.shapesOf, maxNodes: deps.limits().maxNodes }
  );
  const componentOf = placedComponents(stored, deps.limits().maxNodes);
  return report.rows.map(row => {
    const placement = placedBy.get(row.nodeId);
    if (placement === undefined) return row;
    const component = componentOf.get(placement);
    return {
      ...row,
      nodeId: placement,
      ...(component === undefined ? {} : { component }),
    };
  });
}

/** A read's value, or nothing for an absent one. */
function valueOf(read: ReadValue | null): unknown {
  return read !== null && read.kind === "value" ? read.value : undefined;
}

/**
 * The report's rows for one document as stored: each host's working form
 * (the draft where there is one, which an author fixes, else the live value),
 * each row naming the field and language it is in.
 */
async function documentRows(
  hosts: readonly HostCandidate[],
  deps: Pick<BindingReportDeps, "shapesOf" | "limits">,
  reading: DocumentReading
): Promise<BindingReportRow[]> {
  const rows: BindingReportRow[] = [];
  for (const { host } of hosts) {
    const read = await reading.read(host);
    const value = valueOf(read.draft) ?? valueOf(read.published);
    if (value === undefined) continue;
    for (const row of await valueRows(host, value, deps, reading.components)) {
      rows.push({
        ...row,
        blocksField: host.path.join("."),
        ...(host.locale === undefined ? {} : { locale: host.locale }),
      });
    }
  }
  return rows;
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

/** Whether a write's data holds a blocks value at its top level. */
function holdsBlocks(data: Record<string, unknown>): boolean {
  return Object.values(data).some(value => asDocument(value) !== null);
}

/**
 * Judge each written document again, as stored, and record its rows. A write
 * holding no blocks value is judged only when the document already has a row:
 * it may have cleared the field that held the broken binding, and most
 * writes, to documents with no blocks, then read one row and nothing else.
 * After commit, so the row says what is stored; a failure is logged, never
 * thrown, since the write has committed and the next complete check reads it.
 */
export function registerBindingReportOnWrite(
  ctx: BindingReportHooksContext,
  deps: BindingReportDeps
): void {
  const onWrite = async (context: unknown): Promise<void> => {
    const written = hookedDocument(context);
    const store = deps.store();
    const reading = deps.reading();
    if (written === undefined || store === null || reading === null) return;
    const { at, collection } = written;
    try {
      const document = reported(at, deps);
      if (
        !holdsBlocks(written.data) &&
        (await store.get(document.documentKey)) === undefined
      ) {
        return;
      }
      const hosts = await reading.hostsOf(at);
      await store.record(document, await documentRows(hosts, deps, reading));
    } catch (error) {
      ctx.logger.error(
        `[page-builder] the bindings report was not updated for a write to "${collection}"; the next check of every document reads it again.`,
        { collection, error }
      );
    }
  };
  const onDelete = async (context: unknown): Promise<void> => {
    const deleted = hookedDocument(context);
    const store = deps.store();
    if (deleted === undefined || store === null) return;
    const { at, collection } = deleted;
    try {
      // No rows: a deleted document has nothing to fix.
      await store.record(reported(at, deps), []);
    } catch (error) {
      ctx.logger.error(
        `[page-builder] a deleted document's row in the bindings report was not removed; the next check of every document drops it.`,
        { collection, error }
      );
    }
  };
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    ctx.hooks.on(phase, "*", onWrite);
  }
  ctx.hooks.on("afterDelete", "*", onDelete);
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

/** One document judged and recorded, fenced by when it was read. */
async function checkDocument(
  document: HostDocument,
  store: BindingReportStore,
  deps: BindingReportDeps,
  reading: DocumentReading
): Promise<void> {
  const first = document.hosts[0]?.host;
  if (first === undefined) return;
  const readAt = new Date();
  const rows = await documentRows(document.hosts, deps, reading);
  await store.record(reported(first, deps), rows, readAt);
}

/**
 * One pass of the check of every document: nothing when the schema has not
 * changed since the last complete check; else it judges documents from where
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
