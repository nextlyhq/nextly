/**
 * Whether one part of a document is live now: what its readers are served.
 *
 * History records what was published, not what still is. A withdrawal is a
 * draft version like any held save, so "the latest published version" goes on
 * naming a version nobody is served any more. A comparison that offers what is
 * published asks here first.
 *
 * The rule is `languageIsLive`'s, the one answer every path gives, written
 * once as a condition (`partLiveCondition`): a list keeps the documents whose
 * part is live by it, and the read of one part (`readPartIsLive`) asks the same
 * condition of one document, outside any write, on the pooled connection.
 * A due release decides first, as it does for the public read: a document it
 * withdraws is not served, and one it publishes is, before either is written.
 *
 * @module domains/versions/part-liveness
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  and,
  eq,
  inArray,
  isNotNull,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import type { FieldConfig } from "../../collections/fields/types";
import { publicStateNames } from "../../lib/content-states";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { buildCompanionSchema } from "../i18n/runtime/companion-io";
import { resolveCompanionReadiness } from "../i18n/runtime/companion-readiness";
import { NO_DECISIONS, type ReleaseDecisions } from "../releases/release-scope";
import { releaseVisibilityFor } from "../releases/release-visibility";
import type { ReleaseVisibility } from "../releases/release-visibility";

/** What the read needs to know about the document's entity. */
export interface LivenessEntity {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  /** Whether the entity has the draft/published lifecycle. */
  status?: boolean;
  localized?: boolean;
}

/**
 * A language's translation rows, as the condition reads them: the table, and
 * its parent, language and status columns.
 *
 * @experimental
 */
export interface PartLiveLanguageRows {
  table: SQLWrapper;
  parent: SQLWrapper;
  locale: SQLWrapper;
  status: SQLWrapper;
}

/**
 * The condition that the part (a language, or null for the part with none) of
 * the document `id` names is live, decided as `languageIsLive` decides it:
 *
 * - An entity without the lifecycle serves everything it stores: live.
 * - A document a due release withdraws is not live, whatever it stores.
 * - The main row is live when its status is a public one or a due release
 *   publishes the document.
 * - No language, or an entity without status per language: the main row
 *   decides.
 * - The default language: the main row, and its own translation too where it
 *   has a status.
 * - Any other language: the main row, and its own translation's status, which
 *   it must have.
 *
 * `languages` is null where the translation rows cannot be read (their table
 * not there yet): a language then has no status of its own. Never NULL, so a
 * caller may negate it.
 *
 * @experimental
 */
export function partLiveCondition(args: {
  /** Whether the entity has the draft/published lifecycle. */
  lifecycle: boolean;
  part: string | null;
  defaultLocale: string | null;
  /** The document's id, and its main row's status. */
  id: SQLWrapper;
  status: SQLWrapper;
  /** Whether the entity keeps a status per language on its translation rows. */
  perLanguageStatus: boolean;
  languages: PartLiveLanguageRows | null;
  decisions: ReleaseDecisions;
}): SQL {
  if (!args.lifecycle) return sql`(1 = 1)`;
  const states = publicStateNames();
  const isPublic = (status: SQLWrapper): SQL =>
    states.length === 0 ? sql`1 = 0` : inArray(status, [...states]);
  const { id, part, languages } = args;
  const { reveal, hide } = args.decisions;
  const mainLive =
    or(
      isPublic(args.status),
      reveal.length === 0 ? undefined : inArray(id, [...reveal])
    ) ?? sql`1 = 0`;
  /** A translation row of the part's language for the document, holding `holds`. */
  const row = (locale: string, holds: SQL): SQL =>
    languages === null
      ? sql`1 = 0`
      : sql`EXISTS (SELECT 1 FROM ${languages.table} WHERE ${and(
          eq(languages.parent, id),
          eq(languages.locale, locale),
          holds
        )})`;
  let live: SQL = mainLive;
  if (part !== null && args.perLanguageStatus) {
    const ownLive = row(part, isPublic(languages?.status ?? sql`NULL`));
    // A language with no status of its own: no row, or a row with none.
    const ownNone = sql`NOT ${row(part, isNotNull(languages?.status ?? sql`NULL`))}`;
    live =
      (part === args.defaultLocale
        ? and(mainLive, or(ownNone, ownLive))
        : and(mainLive, ownLive)) ?? sql`1 = 0`;
  }
  if (hide.length > 0) live = and(notInArray(id, [...hide]), live) ?? live;
  // A NULL status reads as not live, never as unknown: the condition is
  // negated by a list keeping the parts that are not live.
  return sql`(CASE WHEN ${live} THEN 1 ELSE 0 END = 1)`;
}

/**
 * What {@link partLiveCondition} reads besides the document's own columns,
 * for one entity: whether it has the lifecycle, what a due release decides,
 * and its translation rows where it keeps a status per language.
 *
 * @experimental
 */
export interface PartLivenessInputs {
  lifecycle: boolean;
  decisions: ReleaseDecisions;
  perLanguageStatus: boolean;
  languages: PartLiveLanguageRows | null;
}

/**
 * The inputs {@link partLiveCondition} reads for `entity`, read once for any
 * number of its documents: the due releases of its scope (the public read asks
 * them before its stored status, and so does this: a scheduled publication or
 * withdrawal is in effect before the release writes it), and, where
 * `withLanguages` asks, its translation rows, which a companion whose
 * migration has not run does not offer: a language then has no status of its
 * own. An entity without the lifecycle reads nothing.
 *
 * @experimental
 */
export async function partLivenessInputs(args: {
  adapter: DrizzleAdapter;
  scopeKind: VersionScopeKind;
  entity: LivenessEntity;
  /** Whether a language's part is asked, so the translation rows are read. */
  withLanguages: boolean;
  /** What a due release makes visible; the adapter's shared one if omitted. */
  visibility?: ReleaseVisibility;
  now?: Date;
}): Promise<PartLivenessInputs> {
  const { adapter, entity } = args;
  if (entity.status !== true) {
    return {
      lifecycle: false,
      decisions: NO_DECISIONS,
      perLanguageStatus: false,
      languages: null,
    };
  }
  const decisions = await (
    args.visibility ?? releaseVisibilityFor(adapter)
  ).decisions({
    scopeKind: args.scopeKind,
    scopeSlug: entity.slug,
    now: args.now ?? new Date(),
  });
  const companion =
    args.withLanguages && entity.localized === true
      ? buildCompanionSchema({
          slug: entity.slug,
          tableName: entity.tableName,
          fields: entity.fields as { name: string; type: string }[],
          dialect: adapter.dialect,
          status: true,
        })
      : null;
  const perLanguageStatus = companion?.hasStatus === true;
  const readable =
    companion !== null &&
    perLanguageStatus &&
    (await resolveCompanionReadiness(adapter, {
      companionTableName: companion.companionTableName,
      mainTableName: entity.tableName,
      localizedColumns: companion.localizedFields.map(f => f.column),
    })) === "ready";
  const column = (table: string, name: string): SQL =>
    sql`${sql.identifier(table)}.${sql.identifier(name)}`;
  return {
    lifecycle: true,
    decisions,
    perLanguageStatus,
    languages:
      readable && companion
        ? {
            table: sql.identifier(companion.companionTableName),
            parent: column(companion.companionTableName, "_parent"),
            locale: column(companion.companionTableName, "_locale"),
            status: column(companion.companionTableName, "_status"),
          }
        : null,
  };
}

/**
 * Whether the part (a language, or null for the part with none) is live:
 * {@link partLiveCondition} asked of one document.
 *
 * An entity without the lifecycle serves everything it stores, so every part
 * of it is live.
 */
export async function readPartIsLive(args: {
  adapter: DrizzleAdapter;
  scopeKind: VersionScopeKind;
  entity: LivenessEntity;
  entryId: string;
  part: string | null;
  defaultLocale: string | null;
  /** What a due release makes visible; the adapter's shared one if omitted. */
  visibility?: ReleaseVisibility;
  now?: Date;
}): Promise<boolean> {
  const { adapter, entity, entryId, part } = args;
  if (entity.status !== true) return true;
  const inputs = await partLivenessInputs({
    adapter,
    scopeKind: args.scopeKind,
    entity,
    withLanguages: part !== null,
    visibility: args.visibility,
    now: args.now,
  });
  const main = sql.identifier(entity.tableName);
  const live = partLiveCondition({
    ...inputs,
    part,
    defaultLocale: args.defaultLocale,
    id: sql`${entryId}`,
    // The main row's status, or NULL for a document with no row, which is
    // then live only where a due release publishes it.
    status: sql`(SELECT ${sql.identifier("status")} FROM ${main} WHERE ${sql.identifier("id")} = ${entryId})`,
  });
  const [answer] = await adapter.queryStatement<{ live: unknown }>(
    sql`SELECT CASE WHEN ${live} THEN 1 ELSE 0 END AS ${sql.identifier("live")}`
  );
  return Number(answer?.live) === 1;
}
