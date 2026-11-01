/**
 * Rebuild the whole record of which media items content uses, from what the
 * content tables hold: `nextly media reindex-usage`.
 *
 * For an install whose content was written before the record existed, and
 * after a restore, when the record and the content no longer describe the
 * same thing. Every document is read the way a write reads it
 * (`stored-document-usage`), so a rebuilt record is the one the writes would
 * have kept.
 *
 * The record is emptied first and the marker that says it is complete is
 * taken away until the rebuild has read every document, so a rebuild that
 * stops part way leaves the record saying it is still being built rather
 * than reading as complete. A write made while it runs records its own
 * document as it always does. The rebuild reads each document on a
 * transaction that first locks its row, so it waits for a write to it that
 * is still open and reads what that write committed, rather than reading
 * the document as it was and writing that over the write's record.
 *
 * @module domains/media/usage/reindex-usage
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { MEDIA_USAGE_TABLE } from "../../../schemas/media-usage/table-name";

import { recordEmailTemplateUsage } from "./email-template-usage";
import { lockDocument, MEDIA_USAGE_RECORDED_KEY } from "./media-usage-store";

/** What the rebuild reads and writes through. */
export interface ReindexUsageDeps {
  adapter: Pick<
    DrizzleAdapter,
    | "select"
    | "delete"
    | "transaction"
    | "tableExists"
    | "count"
    | "getCapabilities"
  >;
  /** Each collection's slug, and the rebuild of its entries. */
  collections: {
    slugs(): Promise<string[]>;
    rebuild(slug: string): Promise<number>;
  };
  /** Each Single's slug, and the rebuild of it. */
  singles: {
    slugs(): Promise<string[]>;
    rebuild(slug: string): Promise<boolean>;
  };
  /** Where the record's completeness is kept. */
  meta: {
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /** Told each collection's and Single's progress. */
  say?: (line: string) => void;
}

/** What a rebuild read and wrote. */
export interface ReindexUsageResult {
  /** The documents read: entries, Singles and email templates. */
  documents: number;
  /** The rows the record holds afterwards. */
  rows: number;
}

/** How many templates' ids one read pages through. */
const TEMPLATE_PAGE = 200;

async function rebuildTemplates(
  adapter: ReindexUsageDeps["adapter"]
): Promise<number> {
  if (!(await adapter.tableExists("email_templates"))) return 0;
  let read = 0;
  let after: string | undefined;
  for (;;) {
    const rows = await adapter.select<{ id: string }>("email_templates", {
      columns: ["id"],
      ...(after === undefined
        ? {}
        : { where: { and: [{ column: "id", op: ">", value: after }] } }),
      orderBy: [{ column: "id", direction: "asc" }],
      limit: TEMPLATE_PAGE,
    });
    const { maxParamsPerQuery } = adapter.getCapabilities();
    for (const row of rows) {
      // Each template on a transaction of its own that locks its row first,
      // before it reads anything, so a save of it that is in flight finishes
      // before the rebuild reads what the save left (`lockDocument`).
      await adapter.transaction(async tx => {
        await lockDocument(tx, "email_templates", String(row.id));
        await recordEmailTemplateUsage(tx, String(row.id), maxParamsPerQuery);
      });
    }
    if (rows.length > 0) {
      read += rows.length;
      after = String(rows[rows.length - 1].id);
    }
    if (rows.length < TEMPLATE_PAGE) return read;
  }
}

/**
 * Empty the record, read every collection entry, Single and email template
 * into it, and mark it complete. Refused, changing nothing, before
 * `nextly migrate` has created the record's table.
 */
export async function reindexMediaUsage(
  deps: ReindexUsageDeps
): Promise<ReindexUsageResult> {
  const { adapter } = deps;
  if (!(await adapter.tableExists(MEDIA_USAGE_TABLE))) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "The media usage table does not exist yet. Run `nextly migrate` to create it, then run this again.",
      logContext: { table: MEDIA_USAGE_TABLE },
    });
  }
  await deps.meta.delete(MEDIA_USAGE_RECORDED_KEY);
  await adapter.delete(MEDIA_USAGE_TABLE, {
    and: [{ column: "id", op: "IS NOT NULL" }],
  });

  let documents = 0;
  for (const slug of await deps.collections.slugs()) {
    const read = await deps.collections.rebuild(slug);
    deps.say?.(`Collection ${slug}: ${read} entr${read === 1 ? "y" : "ies"}.`);
    documents += read;
  }
  for (const slug of await deps.singles.slugs()) {
    if (await deps.singles.rebuild(slug)) {
      deps.say?.(`Single ${slug}.`);
      documents += 1;
    }
  }
  const templates = await rebuildTemplates(adapter);
  deps.say?.(`Email templates: ${templates}.`);
  documents += templates;

  await deps.meta.set(MEDIA_USAGE_RECORDED_KEY, {
    rebuiltAt: new Date().toISOString(),
  });
  const rows = await adapter.count(MEDIA_USAGE_TABLE);
  return { documents, rows };
}
