/**
 * Where the index of bindings to Singles is kept (`binding_uses`), and
 * whether it has been filled once: the rows a Single's panel lists, written
 * by the bindings sweep beside the "Bindings to fix" report.
 *
 * A document's rows are replaced in one transaction, and only while the
 * document's report row is not marked again: the same fence the report is
 * settled under (`store.ts`). The row's update holds it until the commit, so
 * a write marking it meanwhile waits, and a later judgement replaces these
 * rows rather than being replaced by them.
 *
 * "Filled" is a mark in the plugin's options table, set when the first check
 * of every document that writes these rows completes; until then the panel
 * says it is still checking pages rather than that nothing binds the Single.
 * A schema change's later check never takes it away.
 *
 * @module bindings-report/uses-store
 */
import { and, asc, eq, inArray, lt, not } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
  type PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { bindingUses, siteOptions } from "../schema/tables";
import { readSiteOption } from "../site-option-read";

import { BINDING_USES_FORMAT, type BindingUse } from "./uses";

/** The "filled" mark's name in the plugin's options table. */
const FILLED_OPTION = "binding-uses-filled";

/** How many rows one insert writes. */
const INSERT_BATCH = 100;

/** How many kept documents a drop of rows no longer found names at most. */
const DROP_KEEP_MAX = 500;

/** One use in a document, and which of its values it is in. */
export interface DocumentUse extends BindingUse {
  readonly version: "draft" | "published";
  /** The language of a value stored per language. */
  readonly locale?: string;
  /** The blocks field it is in, as a dotted path. */
  readonly blocksField: string;
}

/** Which document the uses are in, as the report names it. */
export interface UsedDocument {
  readonly documentKey: string;
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly documentId?: string;
  readonly place: string;
}

/** One stored use, as read back. */
export interface StoredUse extends DocumentUse, UsedDocument {}

/** Replace a document's uses, inside the caller's transaction. */
export async function replaceUses(
  tx: Pick<PluginTransaction, "insert" | "delete" | "table">,
  document: UsedDocument,
  uses: readonly DocumentUse[]
): Promise<void> {
  await tx
    .delete(bindingUses)
    .where(eq(tx.table(bindingUses).documentKey, document.documentKey));
  const now = new Date();
  const rows = uses.map(use => ({
    documentKey: document.documentKey,
    kind: document.kind,
    slug: document.slug,
    documentId: document.documentId ?? null,
    place: document.place,
    version: use.version,
    locale: use.locale ?? null,
    blocksField: use.blocksField,
    nodeId: use.nodeId,
    blockType: use.blockType,
    blockName: use.blockName ?? null,
    prop: use.prop,
    sourceKind: "single",
    sourceKey: use.sourceKey,
    path: use.path,
    createdAt: now,
    updatedAt: now,
  }));
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    await tx.insert(bindingUses, rows.slice(start, start + INSERT_BATCH));
  }
}

/** A stored row as the index reads it. */
function storedUse(row: {
  documentKey: string;
  kind: string;
  slug: string;
  documentId: string | null;
  place: string;
  version: string;
  locale: string | null;
  blocksField: string;
  nodeId: string;
  blockType: string;
  blockName: string | null;
  prop: string;
  sourceKey: string;
  path: string;
}): StoredUse {
  return {
    documentKey: row.documentKey,
    kind: row.kind === "single" ? "single" : "collection",
    slug: row.slug,
    ...(row.documentId === null ? {} : { documentId: row.documentId }),
    place: row.place,
    version: row.version === "draft" ? "draft" : "published",
    ...(row.locale === null ? {} : { locale: row.locale }),
    blocksField: row.blocksField,
    nodeId: row.nodeId,
    blockType: row.blockType,
    ...(row.blockName === null ? {} : { blockName: row.blockName }),
    prop: row.prop,
    sourceKey: row.sourceKey,
    path: row.path,
  };
}

/** The index's reads, for a Single's panel. */
export interface BindingUsesReader {
  /**
   * Up to `limit` uses of one Single, in a stable order: one query, by the
   * index on what the uses read.
   */
  ofSingle(slug: string, limit: number): Promise<StoredUse[]>;
  /** Whether a check of every document has filled the index once. */
  filled(): Promise<boolean>;
}

/** The index's reads over this plugin's own tables. */
export function bindingUsesReader(
  db: Pick<PluginDatabase, "select" | "table">
): BindingUsesReader {
  return {
    ofSingle: async (slug, limit) => {
      const uses = db.table(bindingUses);
      const found = await db
        .select(bindingUses)
        .where(
          and(eq(uses.sourceKind, "single"), eq(uses.sourceKey, slug)) ??
            eq(uses.sourceKey, slug)
        )
        .orderBy(asc(uses.documentKey), asc(uses.nodeId), asc(uses.id))
        .limit(limit)
        .all();
      return found.map(storedUse);
    },
    filled: async () =>
      (await readSiteOption(db, FILLED_OPTION)) === String(BINDING_USES_FORMAT),
  };
}

type Dialect = Parameters<typeof isUniqueViolation>[0];

/** Mark the index filled, for this format. */
export async function markUsesFilled(
  db: Pick<PluginDatabase, "insert" | "update" | "table">,
  dialect: Dialect
): Promise<void> {
  const value = String(BINDING_USES_FORMAT);
  const named = eq(db.table(siteOptions).name, FILLED_OPTION);
  if ((await db.update(siteOptions, { value }).where(named)) > 0) return;
  try {
    await db.insert(siteOptions, { name: FILLED_OPTION, value });
  } catch (error) {
    if (!isUniqueViolation(dialect, error)) throw error;
    await db.update(siteOptions, { value }).where(named);
  }
}

/**
 * Drop the uses written before `before` of documents not in `kept`: the
 * documents a complete check no longer found. A document still marked to be
 * judged keeps its rows until its judgement replaces them, so with more such
 * documents than one statement names, nothing is dropped this time.
 */
export async function dropUsesBefore(
  db: Pick<PluginDatabase, "delete" | "table">,
  before: Date,
  kept: readonly string[]
): Promise<void> {
  if (kept.length > DROP_KEEP_MAX) return;
  const uses = db.table(bindingUses);
  const stale = lt(uses.updatedAt, before);
  await db
    .delete(bindingUses)
    .where(
      kept.length === 0
        ? stale
        : (and(stale, not(inArray(uses.documentKey, [...kept]))) ?? stale)
    );
}
