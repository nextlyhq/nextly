/**
 * Dating every translation from its version history: a translation row with no stamp
 * (`_updated_at` NULL), written before stamps were kept, gets the time of its language's last
 * durable version, so whether it is out of date can be decided. Collections' rows are back-filled
 * whenever their translations table is brought up to date; a Single's never were, so this step is
 * where its rows are dated.
 *
 * The statement is the one collections are back-filled with (`buildUpdatedAtBackfill`): it fills
 * only a stamp that is absent, from that language's own history, so running it again changes
 * nothing and a stamp a later save set is never moved.
 *
 * @module cli/commands/upgrade-steps/localisation-stamps
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { COMPANION_UPDATED_AT_COLUMN } from "../../../domains/i18n/companion-columns";
import { buildUpdatedAtBackfill } from "../../../domains/i18n/migration/reconcile-companion";
import type { LaidOutEntity } from "../../../domains/i18n/per-language-storage-layout";
import { runStatement } from "../../../domains/schema/pipeline/_internal/run-statement";
import { introspectLiveColumns } from "../../../domains/schema/pipeline/diff/introspect-live";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { UpgradeReport, UpgradeStepContext } from "../upgrade-step";

import { siteEntities } from "./localisation-site";

/** An entity whose translations table has rows its history can date. */
interface ToDate {
  entity: LaidOutEntity & { kind: "collection" | "single" };
  table: string;
}

/**
 * Each collection and Single whose translations table keeps stamps and holds a row with none
 * that a durable version in its language can date.
 */
async function entitiesToDate(context: UpgradeStepContext): Promise<ToDate[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const found: ToDate[] = [];
  for (const entity of await siteEntities(context)) {
    if (entity.kind === "component") continue;
    const table = `${entity.tableName}_locales`;
    if (!(await adapter.tableExists(table))) continue;
    const { tables } = await introspectLiveColumns(
      adapter.getDrizzle(),
      adapter.dialect,
      [table]
    );
    const stamped = (tables[0]?.columns ?? []).some(
      column => column.name === COMPANION_UPDATED_AT_COLUMN
    );
    if (!stamped) continue;
    const rows = await adapter.queryStatement<{ found: unknown }>(
      sql`SELECT 1 AS ${sql.identifier("found")} FROM ${sql.identifier(table)} ${sql.identifier("c")}
        WHERE ${sql.identifier("c")}.${sql.identifier(COMPANION_UPDATED_AT_COLUMN)} IS NULL
        AND EXISTS (SELECT 1 FROM ${sql.identifier(VERSIONS_TABLE)} ${sql.identifier("v")}
          WHERE ${sql.identifier("v")}.${sql.identifier("scope_kind")} = ${entity.kind}
          AND ${sql.identifier("v")}.${sql.identifier("scope_slug")} = ${entity.slug}
          AND ${sql.identifier("v")}.${sql.identifier("entry_id")} = ${sql.identifier("c")}.${sql.identifier("_parent")}
          AND ${sql.identifier("v")}.${sql.identifier("locale")} = ${sql.identifier("c")}.${sql.identifier("_locale")}
          AND ${sql.identifier("v")}.${sql.identifier("version_no")} IS NOT NULL)
        LIMIT 1`
    );
    if (rows.length > 0) {
      found.push({ entity: entity as ToDate["entity"], table });
    }
  }
  return found;
}

/** How many entities have translations to date. */
export async function entitiesToStamp(
  context: UpgradeStepContext
): Promise<number> {
  return (await entitiesToDate(context)).length;
}

/** Date each undated translation from its language's history; how many entities were dated. */
export async function stampTranslations(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const found = await entitiesToDate(context);
  for (const { entity, table } of found) {
    for (const statement of buildUpdatedAtBackfill({
      companionTable: table,
      slug: entity.slug,
      dialect: adapter.dialect,
      versionScope: entity.kind,
    })) {
      await runStatement(
        adapter.getDrizzle(),
        adapter.dialect,
        sql.raw(statement)
      );
    }
  }
  return found.length;
}

/** What the dry run lists: each entity whose translations are dated from their history. */
export async function stampsReport(
  context: UpgradeStepContext
): Promise<UpgradeReport> {
  return {
    move: (await entitiesToDate(context)).map(
      ({ entity }) =>
        `the ${entity.kind} "${entity.slug}": translations with no stamp dated from their language's last version`
    ),
    conflicts: [],
    check: [],
  };
}
