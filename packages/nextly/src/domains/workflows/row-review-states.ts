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
  decisionsAbout,
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
  type WaitingPartInput,
} from "./part-waits-for";
import { workflowAttachedTo } from "./registry";
import {
  readReviewStatesOfDocuments,
  type ReviewAssignee,
  type ReviewState,
} from "./review-state-repository";
import {
  readStagePresentation,
  type StagePresentation,
} from "./stage-presentation";
import { allowsPublish } from "./steps";
import type { Workflow } from "./types";

/** One part of a listed document, where it stands. */
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

/** The review read's parts: each configured language of a translated collection the read was
 * judged for (`locales`, null for every one), then the shared part. */
function listedParts(
  localized: boolean,
  localization: ReturnType<typeof appLocalization>,
  locales: readonly string[] | null
): (string | null)[] {
  const languages = localized
    ? (localization?.locales ?? [])
        .map(locale => locale.code)
        .filter(code => locales === null || locales.includes(code))
    : [];
  return [...languages, null];
}

/** Each review state of `ids`, by document and part. */
async function statesByPart(
  adapter: DrizzleAdapter,
  scope: { scopeKind: "collection"; scopeSlug: string },
  ids: readonly string[]
): Promise<Map<string, ReviewState>> {
  const byPart = new Map<string, ReviewState>();
  for (const state of await readReviewStatesOfDocuments(adapter, scope, ids)) {
    byPart.set(partKeyOf(state.entryId, state.part), state);
  }
  return byPart;
}

const partKeyOf = (id: string, part: string | null): string =>
  `${id}:${part ?? ""}`;

/** One document's main row as the page reads it: its revision, and whether each part is live. */
interface MainRow {
  revision: number;
  live: boolean[];
}

/**
 * Each document's revision and each of `parts`' liveness (`partLiveCondition`), read together,
 * one statement per 500 rows. A document whose row is gone has none.
 */
async function readMainRows(
  adapter: DrizzleAdapter,
  entity: { tableName: string },
  liveness: Awaited<ReturnType<typeof partLivenessInputs>>,
  parts: readonly (string | null)[],
  ids: readonly string[],
  defaultLocale: string | null
): Promise<Map<string, MainRow>> {
  const column = (name: string): SQL =>
    sql`${sql.identifier(entity.tableName)}.${sql.identifier(name)}`;
  // Each chunk binds its ids once, and each part's condition binds the chunk's own release
  // decisions (two per id at most) and a few values more: sized so a statement stays well under
  // SQLite's 999 bound values however many languages the parts name.
  const perRead = Math.max(
    1,
    Math.min(ROWS_PER_READ, Math.floor(800 / (1 + 2 * parts.length) - 4))
  );
  const main = new Map<string, MainRow>();
  for (let at = 0; at < ids.length; at += perRead) {
    const chunk = ids.slice(at, at + perRead);
    const decisions = decisionsAbout(liveness.decisions, chunk);
    const liveColumns = parts.map(
      (part, index) =>
        sql`CASE WHEN ${partLiveCondition({
          ...liveness,
          decisions,
          part,
          defaultLocale,
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
  return main;
}

/**
 * The translation counters of `ids`, where the translations table is there to read, as a part's
 * version reads them (`partVersionOn`); `reads` false where it is not.
 */
async function readCounters(
  adapter: DrizzleAdapter,
  table: { table: string; localized: boolean },
  localized: boolean,
  ids: readonly string[]
): Promise<{ reads: boolean; counters: Map<string, Map<string, number>> }> {
  const dialect = adapter.getCapabilities().dialect;
  const languagesTable = `${table.table}_locales`;
  const reads =
    localized &&
    (
      await liveColumnNames(adapter.getDrizzle(), dialect, [languagesTable])
    ).has(languagesTable.toLowerCase());
  return {
    reads,
    counters: reads
      ? await readLanguageRevisions(adapter.getDrizzle(), {
          dialect,
          table: languagesTable,
          ids,
        })
      : new Map(),
  };
}

/**
 * The document's version as a reader of `part` holds it: its revision, and the counters of the
 * languages a read of that part names (a language with no translation row counts 0).
 */
function partVersion(
  revision: number,
  part: string | null,
  readsLanguages: boolean,
  localization: ReturnType<typeof appLocalization>,
  ownCounters: ReadonlyMap<string, number> | undefined
): string {
  const languages = versionLanguagesFor({
    localized: readsLanguages,
    localization,
    locale: part ?? undefined,
  });
  return encodeDocumentVersion(
    revision,
    languages
      ? Object.fromEntries(
          languages.map(code => [code, ownCounters?.get(code) ?? 0])
        )
      : undefined
  );
}

/** What a part's review state says of it, or a part with none: never entered, never moved. */
function stateFields(
  state: ReviewState | null
): Pick<RowPartReview, "enteredAt" | "assignee" | "dueAt" | "revision"> {
  return state === null
    ? { enteredAt: null, assignee: null, dueAt: null, revision: 0 }
    : {
        enteredAt: state.enteredAt,
        assignee: state.assignee,
        dueAt: state.dueAt,
        revision: state.revision,
      };
}

/** One part where it stands, its waiting still to be named. */
function partReview(
  workflow: Workflow,
  shown: (stage: string) => StagePresentation,
  part: string | null,
  stage: string | null,
  state: ReviewState | null,
  version: string
): RowPartReview {
  // The stage as every surface shows it, asked once.
  const presented = stage === null ? null : shown(stage);
  return {
    part,
    stage,
    stageLabel: presented?.label ?? null,
    stageColour: presented?.colour ?? null,
    publishable: stage !== null && allowsPublish(workflow, stage),
    ...stateFields(state),
    waitingFor: null,
    version,
  };
}

/**
 * Whom each listed part waits for, named into it: every assignee and default reviewer of the page
 * checked at once (`prime`), each part decided, and every name read once for the page.
 */
async function nameEachPart(
  adapter: DrizzleAdapter,
  workflow: Workflow,
  slug: string,
  listed: readonly { review: RowPartReview; input: WaitingPartInput }[]
): Promise<void> {
  const decider = partWaitsDecider(adapter, workflow, slug);
  await decider.prime(listed.map(each => each.input));
  const decided: { slug: string; waits: PartWaits }[] = [];
  for (const { input } of listed) {
    decided.push({ slug, waits: await decider.decide(input) });
  }
  const names = await nameWaits(adapter, decided);
  for (const [index, { review }] of listed.entries()) {
    review.waitingFor = names[index] ?? null;
  }
}

/**
 * Each of `ids`'s parts where they stand, documents of the collection `slug`, by id, among the
 * languages `locales` names and the shared part (`null` considers every language): an empty map
 * for a collection no workflow is attached to. A document whose row is gone has no entry.
 */
export async function rowReviewStatesOf(
  adapter: DrizzleAdapter,
  slug: string,
  ids: readonly string[],
  locales: readonly string[] | null
): Promise<Map<string, RowPartReview[]>> {
  const registered = workflowAttachedTo("collection", slug);
  const entity = await entityOf({ scopeKind: "collection", scopeSlug: slug });
  if (!registered || entity === null || ids.length === 0) return new Map();
  const { workflow } = registered;
  const scope = { scopeKind: "collection" as const, scopeSlug: slug };
  const table = await documentTableOn(scope);
  const localization = appLocalization();
  const parts = listedParts(table.localized, localization, locales);
  const stateOf = await statesByPart(adapter, scope, ids);
  const pendingByEntry = await new VersionsRepository(
    adapter
  ).findPendingChangeLocales("collection", slug, [...ids]);
  const liveness = await partLivenessInputs({
    adapter,
    scopeKind: "collection",
    entity,
    withLanguages: table.localized,
  });
  const main = await readMainRows(
    adapter,
    entity,
    liveness,
    parts,
    ids,
    localization?.defaultLocale ?? null
  );
  const { reads, counters } = await readCounters(
    adapter,
    table,
    table.localized && localization !== undefined,
    ids
  );
  const shown = await readStagePresentation(adapter, workflow);

  const listed: {
    id: string;
    review: RowPartReview;
    input: WaitingPartInput;
  }[] = [];
  for (const id of ids) {
    const row = main.get(id);
    if (!row) continue;
    const pending = pendingPartsOf(pendingByEntry.get(id) ?? new Set());
    for (const [index, part] of parts.entries()) {
      const state = stateOf.get(partKeyOf(id, part)) ?? null;
      const stage = partStage(workflow, state, {
        live: row.live[index] === true,
        pending: pending(part),
      });
      const version = partVersion(
        row.revision,
        part,
        reads,
        localization,
        counters.get(id)
      );
      listed.push({
        id,
        review: partReview(workflow, shown, part, stage, state, version),
        input: {
          stage,
          assignee: state?.assignee ?? null,
          enteredBy: state?.enteredBy ?? null,
        },
      });
    }
  }
  await nameEachPart(adapter, workflow, slug, listed);
  const out = new Map<string, RowPartReview[]>();
  for (const { id, review } of listed) {
    out.set(id, [...(out.get(id) ?? []), review]);
  }
  return out;
}
