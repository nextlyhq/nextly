/**
 * Redirects from a file: a CSV of From and To addresses (and, optionally, a
 * type: `temporary`, `302` or `307` for one for now, `gone` or `410` for an
 * address gone for good, whose To cell is left empty) read row by row, as if each were added in turn, through the same
 * rules a person's redirect follows. A dry run shows what every row would do
 * and changes nothing; an import applies the whole file on one transaction,
 * so it lands in full or not at all, and never while any row is refused.
 *
 * @module redirects/import
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import { parseSource, storedTarget } from "./addresses";
import type { ImportResult, ImportRowView, RedirectType } from "./contract";
import { keptFrom, originBeside, servedOf } from "./served";
import {
  putRedirect,
  redirectFrom,
  type RedirectOutcome,
  type StoredRedirect,
} from "./store";

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

/**
 * A type cell read: temporary or gone where it says so, permanent otherwise.
 * `410 Gone`, as some tools write it, is gone too.
 */
function typeOf(cell: string | undefined): RedirectType {
  const value = (cell ?? "").trim().toLowerCase();
  if (value === "temporary" || value === "302" || value === "307") {
    return "temporary";
  }
  if (value === "gone" || value === "410" || value === "410 gone") {
    return "gone";
  }
  return "permanent";
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

/** How a file is imported, and for whom. */
export interface ImportOptions {
  /** Keep the rows, rather than only say what each would do. */
  apply: boolean;
  /** The origin a row's paths are read on, as a visitor opens them. */
  origin: string;
  /** Who the imported redirects are recorded as added by. */
  addedBy: string | null;
  /** Whether a row may replace a redirect already from its From address. */
  mayReplace: boolean;
}

/** The part of a row's view every outcome shares. */
type RowOf = Pick<ImportRowView, "line" | "from" | "to">;

function refusedRow(view: RowOf, says: string, loop = false): ImportRowView {
  return { ...view, kind: "refused", says, refusal: loop ? "loop" : "other" };
}

/**
 * Where a row's redirect is kept: its language, From and To, a To path read
 * on the From address's domain. Or why it can't be, as a refusal.
 */
async function placeOf(
  ctx: PluginContext,
  row: ImportRow,
  origin: string
): Promise<{ locale: string; source: string; target: string } | string> {
  const from = await keptFrom(ctx, row.from, origin);
  // A gone address sends no one anywhere, so a To cell is not read.
  if (row.type === "gone") {
    return { locale: from.locale ?? "", source: from.path, target: "" };
  }
  const to = await keptFrom(ctx, row.to, originBeside(row.from.trim(), origin));
  const locale = from.locale ?? "";
  if (
    from.locale !== undefined &&
    to.locale !== undefined &&
    to.locale !== locale
  ) {
    return "Send it to an address in the same language as the From address.";
  }
  return {
    locale,
    source: from.path,
    target: to.locale === undefined ? row.to : to.path,
  };
}

/** What a saved row did, in the words the dry run shows. */
async function savedRow(
  view: RowOf,
  outcome: Extract<RedirectOutcome, { saved: unknown }>,
  replaced: StoredRedirect | undefined,
  pattern: boolean
): Promise<ImportRowView> {
  const { locale } = outcome.saved;
  if (replaced !== undefined) {
    if (replaced.gone) {
      return {
        ...view,
        kind: "replaced",
        says: `Replaces ${view.from}, gone.`,
      };
    }
    // The old type is named where only the type changes, so the row says why.
    const type =
      replaced.permanent === outcome.saved.permanent && !outcome.saved.gone
        ? ""
        : `, ${replaced.permanent ? "permanent" : "temporary"}`;
    return {
      ...view,
      kind: "replaced",
      says: `Replaces ${view.from} → ${await servedOf(replaced.target, locale)}${type}.`,
    };
  }
  if (outcome.saved.gone) {
    return { ...view, kind: "new", says: "New: answers 410 Gone." };
  }
  if (outcome.chain.length > 1) {
    const final = await servedOf(outcome.saved.target, locale);
    return {
      ...view,
      kind: "joined",
      says: `Chain joined: ${[view.from, ...outcome.chain].join(" → ")} becomes one hop to ${final}.`,
    };
  }
  return {
    ...view,
    kind: "new",
    says: pattern
      ? "New pattern: every old address goes to the same place under the new one."
      : "New.",
  };
}

/** What one row does, applied in turn on `transaction`. */
async function importRow(
  ctx: PluginContext,
  transaction: Transaction,
  row: ImportRow,
  options: ImportOptions
): Promise<ImportRowView> {
  const view = { line: row.line, from: row.from, to: row.to };
  const place = await placeOf(ctx, row, options.origin);
  if (typeof place === "string") return refusedRow(view, place);
  const parsed = parseSource(place.source);
  const existing = parsed.ok
    ? await redirectFrom(ctx, transaction, place.locale, parsed.source)
    : undefined;
  const permanent = row.type !== "temporary";
  const gone = row.type === "gone";
  const unchanged =
    existing !== undefined &&
    (gone
      ? existing.gone
      : !existing.gone &&
        existing.target === storedTarget(place.target) &&
        existing.permanent === permanent);
  if (unchanged) {
    return { ...view, kind: "same", says: "Already there, no change." };
  }
  if (existing !== undefined && !options.mayReplace) {
    return refusedRow(
      view,
      `You can add redirects but not change them, so ${row.from} can't be replaced.`
    );
  }
  const outcome = await putRedirect(
    ctx,
    transaction,
    { ...place, permanent, gone, origin: "import", addedBy: options.addedBy },
    existing?.id
  );
  if ("refused" in outcome) {
    return refusedRow(
      view,
      outcome.refused.replace("That makes a loop", "Loop"),
      outcome.reason === "loop"
    );
  }
  return savedRow(
    view,
    outcome,
    existing,
    parsed.ok && parsed.address.range === true
  );
}

/**
 * Read `rows` as if each were added in turn, on one transaction: kept where
 * `apply` asks and no row is refused, and rolled back otherwise, so a dry run
 * and a refused import change nothing, and an import lands whole.
 */
export async function importRedirects(
  ctx: PluginContext,
  rows: readonly ImportRow[],
  options: ImportOptions
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
        views.push(await importRow(ctx, transaction, row, options));
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
