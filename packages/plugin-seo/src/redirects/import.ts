/**
 * Redirects from a file: a CSV of From and To addresses (and, optionally, a
 * type) read row by row, as if each were added in turn, through the same
 * rules a person's redirect follows. A dry run shows what every row would do
 * and changes nothing; an import applies the whole file on one transaction,
 * so it lands in full or not at all, and never while any row is refused.
 *
 * @module redirects/import
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import { parseSource, storedTarget } from "./addresses";
import type { ImportResult, ImportRowView, RedirectType } from "./contract";
import { keptFrom, servedOf } from "./served";
import { putRedirect, redirectFrom } from "./store";

/** The most rows one file may hold. */
export const MOST_IMPORTED_ROWS = 5000;

/** A row of a file, read. */
export interface ImportRow {
  line: number;
  from: string;
  to: string;
  type: RedirectType;
}

/** The cells of one CSV line, quotes and doubled quotes read as CSV has them. */
function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let at = 0; at < line.length; at++) {
    const char = line[at];
    if (quoted) {
      if (char === '"' && line[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** A type cell read: temporary where it says so, permanent otherwise. */
function typeOf(cell: string | undefined): RedirectType {
  const value = (cell ?? "").toLowerCase();
  return value === "temporary" || value === "302" || value === "307"
    ? "temporary"
    : "permanent";
}

/**
 * The rows of a CSV file: From, To and an optional type in each line, a first
 * line naming the columns passed over, and blank lines ignored. Refused where
 * the file holds more rows than one import takes.
 */
export function readImportFile(text: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const [from = "", to = "", type] = cellsOf(line);
    const header =
      /^(from|source|old)/i.test(from) &&
      /^(to|target|new|destination)/i.test(to);
    if (index === 0 && header) return;
    rows.push({ line: index + 1, from, to, type: typeOf(type) });
  });
  if (rows.length > MOST_IMPORTED_ROWS) {
    throw NextlyError.invalidInput({
      message: `A file can hold up to ${MOST_IMPORTED_ROWS} redirects. Split it, and import each part.`,
      logContext: { reason: "redirect-import-too-long", rows: rows.length },
    });
  }
  return rows;
}

type Transaction = Parameters<typeof putRedirect>[1];

/** What one row does, applied in turn on `transaction`. */
async function importRow(
  ctx: PluginContext,
  transaction: Transaction,
  row: ImportRow,
  origin: string,
  addedBy: string | null
): Promise<ImportRowView> {
  const view = { line: row.line, from: row.from, to: row.to };
  const refused = (says: string, loop = false): ImportRowView => ({
    ...view,
    kind: "refused",
    says,
    refusal: loop ? "loop" : "other",
  });
  const from = await keptFrom(ctx, row.from, origin);
  const to = await keptFrom(ctx, row.to, origin);
  const locale = from.locale ?? "";
  if (
    from.locale !== undefined &&
    to.locale !== undefined &&
    to.locale !== locale
  ) {
    return refused(
      "Send it to an address in the same language as the From address."
    );
  }
  const target = to.locale === undefined ? row.to : to.path;
  const parsed = parseSource(from.path);
  const existing = parsed.ok
    ? await redirectFrom(ctx, transaction, locale, parsed.source)
    : undefined;
  if (existing !== undefined && existing.target === storedTarget(target)) {
    return { ...view, kind: "same", says: "Already there, no change." };
  }
  const outcome = await putRedirect(
    ctx,
    transaction,
    {
      locale,
      source: from.path,
      target,
      permanent: row.type === "permanent",
      origin: "import",
      addedBy,
    },
    existing?.id
  );
  if ("refused" in outcome) {
    return refused(
      outcome.refused.replace("That makes a loop", "Loop"),
      outcome.reason === "loop"
    );
  }
  const final = await servedOf(outcome.saved.target, locale);
  if (existing !== undefined) {
    return {
      ...view,
      kind: "replaced",
      says: `Replaces ${row.from} → ${await servedOf(existing.target, locale)}.`,
    };
  }
  if (outcome.chain.length > 1) {
    return {
      ...view,
      kind: "joined",
      says: `Chain joined: ${[row.from, ...outcome.chain].join(" → ")} becomes one hop to ${final}.`,
    };
  }
  return {
    ...view,
    kind: "new",
    says:
      parsed.ok && parsed.address.range
        ? "New pattern: every old address goes to the same place under the new one."
        : "New.",
  };
}

/**
 * Read `rows` as if each were added in turn, on one transaction: kept where
 * `apply` asks and no row is refused, and rolled back otherwise, so a dry run
 * and a refused import change nothing, and an import lands whole.
 */
export async function importRedirects(
  ctx: PluginContext,
  rows: readonly ImportRow[],
  options: { apply: boolean; origin: string; addedBy: string | null }
): Promise<ImportResult> {
  // Thrown to roll the transaction back once every row has been read.
  const rollBack = NextlyError.conflict({
    reason: "state",
    message: "Nothing in this file was imported.",
    logContext: { reason: "redirect-import-not-applied" },
  });
  let views: ImportRowView[] = [];
  try {
    await ctx.services.collections.withTransaction(async transaction => {
      views = [];
      for (const row of rows) {
        views.push(
          await importRow(
            ctx,
            transaction,
            row,
            options.origin,
            options.addedBy
          )
        );
      }
      if (!options.apply || views.some(view => view.kind === "refused")) {
        throw rollBack;
      }
    });
  } catch (error) {
    if (error !== rollBack) throw error;
    return { rows: views, applied: false };
  }
  return { rows: views, applied: true };
}
