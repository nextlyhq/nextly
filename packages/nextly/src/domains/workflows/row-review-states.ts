/**
 * The review state of every row of a collection list's page, read for the page at once: each
 * part where it stands, as the document's own review read places it (`reviewStateOf`), with what
 * a list's Review column and its bulk moves need. That is the stage, its label and colour, the
 * assignee, whom it waits for, when it is due and entered, and the revision and version a move
 * names as seen.
 *
 * Each question is the one every step asks, asked of the page together:
 * - where a part stands is `partStage`, from its review state, its liveness (the versions
 *   domain's `partLiveCondition`) and its pending draft (`pendingPartsOf`);
 * - whom it waits for is `partWaitsDecider`, named once for the page (`nameWaits`);
 * - its version is the document's revision and its languages' counters, spelled for the part's
 *   language as a read of that part spells it (`documentVersionOn`'s languages).
 *
 * So the statements a page costs do not grow with its rows: the review states, the pending drafts,
 * the main rows (their revision and each part's liveness together), the translation counters and
 * the names, each read once per 500 rows.
 *
 * @module domains/workflows/row-review-states
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, type SQL } from "drizzle-orm";

import { appLocalization } from "../i18n/configured-locales";
import { liveColumnNames } from "../schema/pipeline/diff/introspect-live";
import {
  DOCUMENT_REVISION_COLUMN,
  encodeDocumentVersion,
  readLanguageRevisions,
  revisionOf,
  versionLanguagesFor,
} from "../versions/document-revision";
import {
  partLiveCondition,
  partLivenessInputs,
} from "../versions/part-liveness";
import { VersionsRepository } from "../versions/versions-repository";

import { entityOf, partStage, pendingPartsOf } from "./implicit-stage";
import { documentTableOn } from "./part-versions";
import {
  nameWaits,
  partWaitsDecider,
  type PartWaitingFor,
  type PartWaits,
} from "./part-waits-for";
import { workflowAttachedTo } from "./registry";
import {
  readReviewStatesOfDocuments,
  type ReviewAssignee,
  type ReviewState,
  type ReviewStatesDb,
} from "./review-state-repository";
import { readStagePresentation } from "./stage-presentation";
import { allowsPublish } from "./steps";

/** One part of a listed document, where it stands. @experimental */
export interface RowPartReview {
  /** A language, or null for the shared part. */
  part: string | null;
  /** The stage it stands in; null for a live part with nothing waiting to go live. */
  stage: string | null;
  stageLabel: string | null;
  stageColour: string | null;
  /** Whether its stage allows publishing. */
  publishable: boolean;
  enteredAt: Date | null;
  assignee: ReviewAssignee | null;
  dueAt: Date | null;
  /** Who it waits for, as the document's review read names it. */
  waitingFor: PartWaitingFor | null;
  /** Its review-state revision, 0 for a part with none yet: what a move says it saw. */
  revision: number;
  /** The document's version as a reader of this part holds it: what a move says it saw. */
  version: string | null;
}

/** Rows per statement: SQLite binds 999 values at most, the lowest of the dialects. */
const ROWS_PER_READ = 500;

/**
 * Each of `ids`'s parts where they stand, documents of the collection `slug`, by id, among the
 * languages `locales` names and the shared part (`null` considers every language): an empty map
 * for a collection no workflow is attached to. A document whose row is gone has no entry.
 *
 * @experimental
 */
export async function rowReviewStatesOf(
  adapter: DrizzleAdapter,
  slug: string,
  ids: readonly string[],
  locales: readonly string[] | null
): Promise<Map<string, RowPartReview[]>> {
  const out = new Map<string, RowPartReview[]>();
  const registered = workflowAttachedTo("collection", slug);
  const entity = await entityOf({ scopeKind: "collection", scopeSlug: slug });
  if (!registered || entity === null || ids.length === 0) return out;
  const { workflow } = registered;
  const scope = { scopeKind: "collection" as const, scopeSlug: slug };
  const table = await documentTableOn(scope);
  const localization = appLocalization();
  // The review read's parts: each configured language of a translated collection, then the
  // shared part; here only those the read was judged for.
  const parts: (string | null)[] = [
    ...(table.localized
      ? (localization?.locales ?? [])
          .map(locale => locale.code)
          .filter(code => locales === null || locales.includes(code))
      : []),
    null,
  ];
  const dialect = adapter.getCapabilities().dialect;

  const states = await readReviewStatesOfDocuments(adapter, scope, ids);
  const stateOf = new Map<string, ReviewState>();
  for (const state of states) {
    stateOf.set(`${state.entryId}:${state.part ?? ""}`, state);
  }
  const pendingByEntry = await new VersionsRepository(
    adapter
  ).findPendingChangeLocales("collection", slug, [...ids]);

  // Each part's liveness and the main row's revision, one statement per 500 rows.
  const liveness = await partLivenessInputs({
    adapter,
    scopeKind: "collection",
    entity,
    withLanguages: table.localized,
  });
  const column = (name: string): SQL =>
    sql`${sql.identifier(entity.tableName)}.${sql.identifier(name)}`;
  const main = new Map<string, { revision: number; live: boolean[] }>();
  for (let at = 0; at < ids.length; at += ROWS_PER_READ) {
    const chunk = ids.slice(at, at + ROWS_PER_READ);
    const liveColumns = parts.map(
      (part, index) =>
        sql`CASE WHEN ${partLiveCondition({
          ...liveness,
          part,
          defaultLocale: localization?.defaultLocale ?? null,
          id: column("id"),
          status: column("status"),
        })} THEN 1 ELSE 0 END AS ${sql.identifier(`live_${index}`)}`
    );
    const rows = await adapter.queryStatement<Record<string, unknown>>(
      sql`SELECT ${column("id")} AS ${sql.identifier("id")}, ${column(DOCUMENT_REVISION_COLUMN)} AS ${sql.identifier("revision")}, ${sql.join(liveColumns, sql`, `)} FROM ${sql.identifier(entity.tableName)} WHERE ${column("id")} IN (${sql.join(
        chunk.map(id => sql`${id}`),
        sql`, `
      )})`
    );
    for (const row of rows) {
      main.set(String(row.id), {
        revision: revisionOf(row.revision),
        live: parts.map((_, index) => Number(row[`live_${index}`]) === 1),
      });
    }
  }

  // The translation counters, where the translations table is there to read, as a part's
  // version reads them (`partVersionOn`).
  const languagesTable = `${table.table}_locales`;
  const readsLanguages =
    table.localized &&
    localization !== undefined &&
    (
      await liveColumnNames(adapter.getDrizzle(), dialect, [languagesTable])
    ).has(languagesTable.toLowerCase());
  const counters = readsLanguages
    ? await readLanguageRevisions(adapter.getDrizzle(), {
        dialect,
        table: languagesTable,
        ids,
      })
    : new Map<string, Map<string, number>>();

  const shown = await readStagePresentation(adapter, workflow);
  const decide = partWaitsDecider(adapter, workflow, slug);
  const listed: { id: string; review: RowPartReview }[] = [];
  const decided: { slug: string; waits: PartWaits }[] = [];
  for (const id of ids) {
    const row = main.get(id);
    if (!row) continue;
    const pending = pendingPartsOf(pendingByEntry.get(id) ?? new Set());
    for (const [index, part] of parts.entries()) {
      const state = stateOf.get(`${id}:${part ?? ""}`) ?? null;
      const stage = partStage(workflow, state, {
        live: row.live[index] === true,
        pending: pending(part),
      });
      const languages = versionLanguagesFor({
        localized: readsLanguages,
        localization,
        locale: part ?? undefined,
      });
      const ownCounters = counters.get(id);
      listed.push({
        id,
        review: {
          part,
          stage,
          stageLabel: stage === null ? null : shown(stage).label,
          stageColour: stage === null ? null : shown(stage).colour,
          publishable: stage !== null && allowsPublish(workflow, stage),
          enteredAt: state?.enteredAt ?? null,
          assignee: state?.assignee ?? null,
          dueAt: state?.dueAt ?? null,
          waitingFor: null,
          revision: state?.revision ?? 0,
          version: encodeDocumentVersion(
            row.revision,
            languages
              ? Object.fromEntries(
                  // A language with no translation row counts 0, as a part's version spells it.
                  languages.map(code => [code, ownCounters?.get(code) ?? 0])
                )
              : undefined
          ),
        },
      });
      decided.push({
        slug,
        waits: await decide({
          stage,
          assignee: state?.assignee ?? null,
          enteredBy: state?.enteredBy ?? null,
        }),
      });
    }
  }
  // Whom each part waits for, named once for the page.
  const names = await nameWaits(adapter, decided);
  for (const [index, { id, review }] of listed.entries()) {
    review.waitingFor = names[index] ?? null;
    out.set(id, [...(out.get(id) ?? []), review]);
  }
  return out;
}
