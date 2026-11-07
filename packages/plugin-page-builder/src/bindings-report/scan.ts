/**
 * Keeping the "Bindings to fix" report current: a document is judged again
 * when it is saved, and every document when the schema it is judged against
 * changes.
 *
 * Nothing tells a plugin that a collection's fields, a Single's fields or a
 * block's props changed, so the check of every document compares a
 * fingerprint of all three with the one the last complete check was made
 * against. It runs as a sweep job, a jobs pass at a time, and resumes where a
 * pass stopped, so a large site is checked over several passes without any
 * pass running long. A document deleted since is dropped when a complete check
 * finds it gone.
 *
 * Judged as the system: the report says what is broken; who may see each row
 * is the route's question.
 *
 * @module bindings-report/scan
 */
import {
  isPlainRecord,
  type BindingSchemaRef,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";

import { asDocument } from "../component-store-source";
import type { DeclaredShapesReader } from "../fields/binding-judgement";
import { hookDocumentOf } from "../host-rewrite/after-commit";
import { documentKeyOf, type HostAddress } from "../host-rewrite/contract";
import type {
  HostDocument,
  HostReader,
  ReadValue,
} from "../host-rewrite/rewrite";

import { documentBindingReport, type BindingReportRow } from "./rows";
import type { BindingReportStore, ReportedDocument } from "./store";

/** What keeping the report needs of the installed plugin. */
export interface BindingReportDeps {
  /** The report's store; `null` before the plugin's tables are ready. */
  readonly store: () => BindingReportStore | null;
  readonly shapesOf: DeclaredShapesReader;
  readonly limits: () => DocumentLimits;
  /** Where a document lives: pages, components, patterns, layouts, entries or singles. */
  readonly placeOf: (at: Pick<HostAddress, "kind" | "slug">) => string;
}

/** One blocks value of a document, and where it is. */
interface BlocksValue {
  readonly field: string;
  readonly locale?: string;
  readonly value: unknown;
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
 * The report's rows for one document's blocks values, each row naming the
 * field and language it is in. A value binding more sources than one check
 * reads is left out: its bindings are refused at save, so it is not the kind
 * of break a schema change makes.
 */
async function documentRows(
  at: Pick<HostAddress, "kind" | "slug">,
  values: readonly BlocksValue[],
  deps: Pick<BindingReportDeps, "shapesOf" | "limits">
): Promise<BindingReportRow[]> {
  const rows: BindingReportRow[] = [];
  for (const { field, locale, value } of values) {
    const document = asDocument(value);
    if (document === null) continue;
    const report = await documentBindingReport(
      { nodes: document.nodes, settings: document.settings },
      entryRef(at, document),
      { shapesOf: deps.shapesOf, maxNodes: deps.limits().maxNodes }
    );
    for (const row of report.rows) {
      rows.push({
        ...row,
        blocksField: field,
        ...(locale === undefined ? {} : { locale }),
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

/**
 * The blocks values a committed write holds at its top level, as written: the
 * working form a later read sees. A write holding none, which is most writes,
 * reads nothing.
 */
function writtenValues(data: Record<string, unknown>): BlocksValue[] {
  return Object.entries(data).flatMap(([field, value]) =>
    asDocument(value) === null ? [] : [{ field, value }]
  );
}

/**
 * Judge each committed write's document again and record its rows. After
 * commit, so the row says what is stored; a failure is logged, never thrown,
 * since the write has committed and the next complete check reads it again.
 */
export function registerBindingReportOnWrite(
  ctx: BindingReportHooksContext,
  deps: BindingReportDeps
): void {
  const onWrite = async (context: unknown): Promise<void> => {
    const fields = context as { collection?: unknown; data?: unknown };
    if (typeof fields.collection !== "string" || !isPlainRecord(fields.data)) {
      return;
    }
    const values = writtenValues(fields.data);
    const at = hookDocumentOf(fields.collection, fields.data);
    const store = deps.store();
    if (values.length === 0 || at === undefined || store === null) return;
    try {
      await store.record(
        reported(at, deps),
        await documentRows(at, values, deps)
      );
    } catch (error) {
      ctx.logger.error(
        `[page-builder] the bindings report was not updated for a write to "${fields.collection}"; the next check of every document reads it again.`,
        { collection: fields.collection, error }
      );
    }
  };
  const onDelete = async (context: unknown): Promise<void> => {
    const fields = context as { collection?: unknown; data?: unknown };
    if (typeof fields.collection !== "string" || !isPlainRecord(fields.data)) {
      return;
    }
    const at = hookDocumentOf(fields.collection, fields.data);
    const store = deps.store();
    if (at === undefined || store === null) return;
    try {
      // No rows: a deleted document has nothing to fix.
      await store.record(reported(at, deps), []);
    } catch (error) {
      ctx.logger.error(
        `[page-builder] a deleted document's row in the bindings report was not removed; the next check of every document drops it.`,
        { collection: fields.collection, error }
      );
    }
  };
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    ctx.hooks.on(phase, "*", onWrite);
  }
  ctx.hooks.on("afterDelete", "*", onDelete);
}

/** A read's value, or nothing for an absent one. */
function valueOf(read: ReadValue | null): unknown {
  return read !== null && read.kind === "value" ? read.value : undefined;
}

/** What the check of every document reads the site through. */
export interface FullCheckSite {
  /** Every document holding blocks, after a cursor, in a stable order. */
  readonly documents: (cursor: string | null) => AsyncIterable<HostDocument>;
  readonly cursorOf: (document: HostDocument) => string;
  readonly read: HostReader;
  /** The fingerprint of the schema documents are judged against now. */
  readonly fingerprint: () => Promise<string>;
}

/** How a pass of the check of every document ended. */
export type FullCheckOutcome = "current" | "paused" | "complete";

/** One document's working form in each of its hosts, judged and recorded. */
async function checkDocument(
  document: HostDocument,
  site: FullCheckSite,
  store: BindingReportStore,
  deps: BindingReportDeps
): Promise<void> {
  const first = document.hosts[0]?.host;
  if (first === undefined) return;
  const values: BlocksValue[] = [];
  for (const candidate of document.hosts) {
    const read = await site.read(candidate.host);
    // The working draft where there is one: what the editor shows and an
    // author fixes; else the live value.
    const value = valueOf(read.draft) ?? valueOf(read.published);
    if (value === undefined) continue;
    values.push({
      field: candidate.host.path.join("."),
      ...(candidate.host.locale === undefined
        ? {}
        : { locale: candidate.host.locale }),
      value,
    });
  }
  await store.record(
    reported(first, deps),
    await documentRows(first, values, deps)
  );
}

/**
 * One pass of the check of every document: nothing when the schema has not
 * changed since the last complete check; else it judges documents from where
 * the last pass stopped until `deadline`, and records where it stopped. A
 * complete check records the fingerprint it was made against and drops the
 * rows of documents it no longer found.
 */
export async function runFullCheck(
  site: FullCheckSite,
  deps: BindingReportDeps,
  deadline: Date
): Promise<FullCheckOutcome> {
  const store = deps.store();
  if (store === null) return "paused";
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
  await store.setFullCheck({
    checked: state.checked,
    checking: fingerprint,
    cursor,
    startedAt,
  });
  for await (const document of site.documents(cursor)) {
    if (Date.now() >= deadline.getTime()) {
      await store.setFullCheck({
        checked: state.checked,
        checking: fingerprint,
        cursor,
        startedAt,
      });
      return "paused";
    }
    await checkDocument(document, site, store, deps);
    cursor = site.cursorOf(document);
  }
  // Every document still on the site was judged since the check started, so a
  // row older than that is a document no longer there.
  await store.dropCheckedBefore(startedAt);
  await store.setFullCheck({
    checked: fingerprint,
    checking: null,
    cursor: null,
    startedAt: null,
  });
  return "complete";
}
