/**
 * The precondition for turning translation off on a Draft/Published entity that keeps its
 * translatable values per language under `experimental.perLanguageStorage`.
 *
 * Turning it off drops each language's own publish state (`_status` on the per-language table)
 * and leaves the entry's. That loses nothing only where every language's state is the entry's,
 * so a change that would drop a different one is refused before anything is written, naming how
 * many entries disagree, rather than settled in silence on the entry's state.
 *
 * @module domains/i18n/runtime/language-states-agree
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

import { companionHasStatusColumn } from "./companion-io";

/**
 * Refuse when an entry of `tableName` has a language whose publish state differs from its own.
 * Nothing to check where the per-language table keeps no `_status`, as one that never had it.
 */
export async function assertLanguageStatesAgreeWithEntry(
  adapter: Pick<DrizzleAdapter, "queryStatement" | "tableExists"> &
    Parameters<typeof companionHasStatusColumn>[0],
  args: { kind: "collection" | "single"; slug: string; tableName: string }
): Promise<void> {
  const companionTable = `${args.tableName}_locales`;
  if (
    !(await adapter.tableExists(companionTable)) ||
    !(await companionHasStatusColumn(adapter, companionTable))
  ) {
    return;
  }
  const main = sql.identifier(args.tableName);
  const companion = sql.identifier(companionTable);
  const [row] = await adapter.queryStatement<{ n: unknown }>(
    sql`SELECT COUNT(DISTINCT ${companion}.${sql.identifier("_parent")}) AS n FROM ${companion} JOIN ${main} ON ${main}.${sql.identifier("id")} = ${companion}.${sql.identifier("_parent")} WHERE ${companion}.${sql.identifier("_status")} <> ${main}.${sql.identifier("status")}`
  );
  const disagreeing = Number(row?.n ?? 0);
  if (disagreeing === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message:
      disagreeing === 1
        ? "1 entry has a language whose publish state differs from the entry's; publish or unpublish so they agree first."
        : `${disagreeing} entries have a language whose publish state differs from the entry's; publish or unpublish so they agree first.`,
    logContext: {
      reason: "translation-off-language-states-differ",
      kind: args.kind,
      slug: args.slug,
      entries: disagreeing,
    },
  });
}
