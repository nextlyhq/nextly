/**
 * Keeping every pending change by part: a working draft that holds a whole document is split into
 * the shared draft and its language's draft, by comparing it with what is live.
 *
 * Before per-language storage, a document kept one draft per language, each holding the whole
 * document in that language, its shared values included. Once upgraded, a document keeps one
 * shared draft holding only shared values, and one draft per language holding only that
 * language's values (`part-drafts`). So each whole-document draft is split:
 * - its language's values become that language's draft (a draft kept under no language, as a
 *   document that is not translated keeps one, is its default language's);
 * - each shared value that differs from the live one becomes part of the shared draft. A value
 *   equal to live is a copy the draft carried, not an edit, so it starts no shared draft;
 * - where two languages' drafts changed the same shared field differently, the later save wins,
 *   and the conflict is listed for an editor.
 *
 * A shared value with no column on the live row (one kept in a table of its own) cannot be told
 * from a copy, so it is kept as an edit: a pending change is never dropped.
 *
 * @module cli/commands/upgrade-steps/localisation-drafts
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { storesPerLanguage } from "../../../domains/i18n/per-language-storage";
import type { LaidOutEntity } from "../../../domains/i18n/per-language-storage-layout";
import { introspectLiveColumns } from "../../../domains/schema/pipeline/diff/introspect-live";
import { SHARED_PART_ALONE } from "../../../domains/versions/changed-parts";
import {
  partKeysOf,
  type PartKeys,
} from "../../../domains/versions/part-drafts";
import {
  sameSharedValue,
  snapshotRecord,
} from "../../../domains/versions/shared-publish-base";
import {
  VersionsRepository,
  WORKING_DRAFT_SHAPE,
  type VersionRef,
  type VersionRow,
} from "../../../domains/versions/versions-repository";
import { NextlyError } from "../../../errors/nextly-error";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { toSnakeCase } from "../../../shared/lib/case-conversion";
import type { UpgradeReport, UpgradeStepContext } from "../upgrade-step";

import {
  assertVersionHistoryReady,
  siteEntities,
  siteLanguages,
  versionHistoryReady,
} from "./localisation-site";

/** A document whose pending changes are kept whole, with what splitting them needs. */
interface DocumentToSplit {
  entity: LaidOutEntity;
  keys: PartKeys;
  ref: VersionRef;
  drafts: VersionRow[];
}

/** Whether `snapshot` holds any of `keys`. */
function holdsAny(
  snapshot: Record<string, unknown>,
  keys: ReadonlySet<string>
): boolean {
  return Object.keys(snapshot).some(key => keys.has(key));
}

/**
 * Whether a working draft holds more than its part: a language's draft holding a shared value,
 * or one kept under no language holding a language's value.
 */
function keptWhole(draft: VersionRow, keys: PartKeys): boolean {
  const snapshot = snapshotRecord(draft.snapshot);
  return draft.locale === null
    ? holdsAny(snapshot, keys.language)
    : holdsAny(snapshot, keys.shared);
}

/** Every document with a pending change kept whole, entity by entity. */
async function documentsToSplit(
  context: UpgradeStepContext
): Promise<DocumentToSplit[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const found: DocumentToSplit[] = [];
  // An earlier release's version history is split only once it is laid out as this one keeps it.
  await assertVersionHistoryReady(context);
  if (!(await versionHistoryReady(context))) return found;
  for (const entity of await siteEntities(context)) {
    // Only collection entries and Singles keep pending changes; a component's are its parent's.
    if (entity.kind === "component") continue;
    const drafts = await adapter.select<VersionRow>(VERSIONS_TABLE, {
      where: {
        and: [
          { column: "scopeKind", op: "=", value: entity.kind },
          { column: "scopeSlug", op: "=", value: entity.slug },
          ...WORKING_DRAFT_SHAPE,
        ],
      },
    });
    if (drafts.length === 0) continue;
    // Classified by where the entity's values are stored, as a save classifies them: under
    // per-language storage an entity that is not translated still keeps its translatable fields
    // per language, so a pending text edit belongs to a language's draft.
    const keys = await partKeysOf(entity.fields, {
      translated: storesPerLanguage(entity),
    });
    const byEntry = new Map<string, VersionRow[]>();
    for (const draft of drafts) {
      byEntry.set(draft.entryId, [
        ...(byEntry.get(draft.entryId) ?? []),
        draft,
      ]);
    }
    for (const [entryId, entryDrafts] of byEntry) {
      if (!entryDrafts.some(draft => keptWhole(draft, keys))) continue;
      found.push({
        entity,
        keys,
        ref: { scopeKind: entity.kind, scopeSlug: entity.slug, entryId },
        drafts: entryDrafts,
      });
    }
  }
  return found;
}

/** A shared field changed by two languages' drafts, and which save won. */
interface SharedConflict {
  field: string;
  earlier: string;
  later: string;
}

/** What one document's drafts become once kept by part. */
interface SplitDrafts {
  /** The shared draft's values, where any shared value differs from live. */
  shared: Record<string, unknown>;
  /** Each language's draft values. */
  languages: Map<string, Record<string, unknown>>;
  conflicts: SharedConflict[];
  /** Conflicts whose two saves were made at the same moment, so neither is the later. */
  ties: SharedConflict[];
}

/** The time a draft was last saved, for ordering its document's drafts oldest first. */
function savedAt(draft: VersionRow): number {
  const at = draft.updatedAt ?? draft.createdAt;
  return at === undefined || at === null ? 0 : new Date(at).getTime();
}

/**
 * Whether a draft's value for `key` is an edit of a shared field: a shared field whose value
 * differs from live. A value equal to live is a copy the whole-document draft carried; a draft
 * already shared keeps every shared value it holds, each saved as an edit.
 */
function isSharedEdit(
  document: DocumentToSplit,
  live: Record<string, unknown> | undefined,
  alreadyShared: boolean,
  key: string,
  value: unknown
): boolean {
  if (!document.keys.shared.has(key)) return false;
  if (alreadyShared || !live) return true;
  const column = toSnakeCase(key);
  return !(column in live && sameSharedValue(live[column], value));
}

/** Where each language's value of a field came from, by `[slot, field]`. */
type LanguageOrigins = Map<
  string,
  { value: unknown; from: string; at: number }
>;

/**
 * Records `draft`'s value of the language field `key` for its language (`slot`), and returns the
 * tie it makes, if any: a pending change kept under no language and one kept under the default
 * language both become that language's draft, and where they hold different values for one field
 * and were saved at the same moment, the order the rows were read in would pick the value kept.
 */
function languageValueTie(
  origins: LanguageOrigins,
  slot: string,
  key: string,
  value: unknown,
  draft: VersionRow
): SharedConflict | undefined {
  const at = savedAt(draft);
  const from = draft.locale ?? "no language";
  const id = JSON.stringify([slot, key]);
  const earlier = origins.get(id);
  origins.set(id, { value, from, at });
  if (
    earlier === undefined ||
    earlier.from === from ||
    earlier.at !== at ||
    sameSharedValue(earlier.value, value)
  ) {
    return undefined;
  }
  return { field: key, earlier: earlier.from, later: from };
}

/** What one document's drafts become, as they are read oldest save first. */
interface SplitState {
  shared: Map<string, { value: unknown; from: string; at: number }>;
  languages: Map<string, Record<string, unknown>>;
  conflicts: SharedConflict[];
  ties: SharedConflict[];
  languageOrigins: LanguageOrigins;
}

/**
 * Records a shared edit of `key` saved `at` (from `from`): a later save's value replaces an earlier
 * one, and where they differ the disagreement is recorded, as a tie where both were saved at the
 * same moment, since the order the rows were read in would then pick the value kept.
 */
function recordSharedEdit(
  state: SplitState,
  key: string,
  value: unknown,
  from: string,
  at: number
): void {
  const earlier = state.shared.get(key);
  if (earlier && !sameSharedValue(earlier.value, value)) {
    const conflict = { field: key, earlier: earlier.from, later: from };
    if (earlier.at === at) state.ties.push(conflict);
    else state.conflicts.push(conflict);
  }
  state.shared.set(key, { value, from, at });
}

/** Reads one draft into `state`: each language value under its language, each shared edit as one. */
function readDraft(
  state: SplitState,
  document: DocumentToSplit,
  live: Record<string, unknown> | undefined,
  defaultLocale: string,
  draft: VersionRow
): void {
  const snapshot = snapshotRecord(draft.snapshot);
  // A draft under no language that holds only shared values is already the shared draft: its
  // values were saved as shared edits, so each is kept as one.
  const alreadyShared =
    draft.locale === null && !holdsAny(snapshot, document.keys.language);
  const slot = draft.locale ?? defaultLocale;
  for (const [key, value] of Object.entries(snapshot)) {
    if (document.keys.language.has(key)) {
      const tie = languageValueTie(
        state.languageOrigins,
        slot,
        key,
        value,
        draft
      );
      if (tie) state.ties.push(tie);
      state.languages.set(slot, { ...state.languages.get(slot), [key]: value });
      continue;
    }
    if (!isSharedEdit(document, live, alreadyShared, key, value)) continue;
    recordSharedEdit(
      state,
      key,
      value,
      alreadyShared ? "shared" : slot,
      savedAt(draft)
    );
  }
}

/**
 * Split one document's drafts against its live row (`live`, by column): oldest save first, so a
 * later save's shared value replaces an earlier one, each such disagreement recorded.
 */
function splitDrafts(
  document: DocumentToSplit,
  live: Record<string, unknown> | undefined,
  defaultLocale: string
): SplitDrafts {
  const state: SplitState = {
    shared: new Map(),
    languages: new Map(),
    conflicts: [],
    ties: [],
    languageOrigins: new Map(),
  };
  const ordered = [...document.drafts].sort((a, b) => savedAt(a) - savedAt(b));
  for (const draft of ordered) {
    readDraft(state, document, live, defaultLocale, draft);
  }
  return {
    shared: Object.fromEntries(
      [...state.shared].map(([key, { value }]) => [key, value])
    ),
    languages: state.languages,
    conflicts: state.conflicts,
    ties: state.ties,
  };
}

/**
 * The live row of `document`, by column: the columns of its shared fields that its main table
 * has, read through a statement since the upgrade's connection registers no content tables.
 * Nothing where the document has no row, or none of those columns.
 */
async function liveRowOf(
  adapter: DrizzleAdapter,
  document: DocumentToSplit
): Promise<Record<string, unknown> | undefined> {
  const { tables } = await introspectLiveColumns(
    adapter.getDrizzle(),
    adapter.dialect,
    [document.entity.tableName]
  );
  const present = new Set(
    (tables[0]?.columns ?? []).map(column => column.name)
  );
  const columns = [...document.keys.shared]
    .map(key => toSnakeCase(key))
    .filter(column => present.has(column));
  if (columns.length === 0) return undefined;
  const [row] = await adapter.queryStatement<Record<string, unknown>>(
    sql`SELECT ${sql.join(
      columns.map(column => sql.identifier(column)),
      sql`, `
    )} FROM ${sql.identifier(document.entity.tableName)} WHERE ${sql.identifier("id")} = ${document.ref.entryId}`
  );
  return row;
}

/** One document to split, and what its drafts become. */
interface PlannedSplit {
  document: DocumentToSplit;
  split: SplitDrafts;
}

/**
 * Every document to split and what its drafts become, refused before any is split where two
 * languages changed one shared field in saves made at the same moment: nothing says which change
 * came later, so neither is kept on a guess. The count, the run and the dry run read this one plan.
 */
async function plannedSplits(
  context: UpgradeStepContext
): Promise<PlannedSplit[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const { defaultLocale } = await siteLanguages(context);
  const planned: PlannedSplit[] = [];
  for (const document of await documentsToSplit(context)) {
    planned.push({
      document,
      split: splitDrafts(
        document,
        await liveRowOf(adapter, document),
        defaultLocale
      ),
    });
  }
  const tied = planned.flatMap(({ document, split }) =>
    split.ties.map(
      tie =>
        `the ${document.entity.kind} "${document.entity.slug}" entry ${document.ref.entryId} ` +
        `(${tie.field}, in ${tie.earlier} and ${tie.later})`
    )
  );
  if (tied.length > 0) {
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED",
      publicMessage:
        `Pending changes to one field were saved at the same moment for ${tied.join("; ")}, so ` +
        "which change came later cannot be told. Give the field the same value in those pending " +
        "changes, or discard one of them, then run `nextly migrate` again. Nothing was changed.",
      logContext: { ties: tied },
    });
  }
  return planned;
}

/** How many documents keep a pending change whole. */
export async function documentsWithDraftsToSplit(
  context: UpgradeStepContext
): Promise<number> {
  return (await plannedSplits(context)).length;
}

/** Split each document's whole-document drafts by part; how many documents were split. */
export async function splitDraftsByPart(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const planned = await plannedSplits(context);
  for (const { document, split } of planned) {
    // The latest author stays the drafts' author.
    const latest = [...document.drafts].sort(
      (a, b) => savedAt(b) - savedAt(a)
    )[0];
    const createdBy = latest?.createdBy ?? null;
    // One document at a time, all or nothing: its drafts replaced together.
    await adapter.transaction(async tx => {
      const repo = new VersionsRepository(tx);
      for (const draft of document.drafts) {
        await repo.deleteWorkingDraft(document.ref, draft.locale);
      }
      if (Object.keys(split.shared).length > 0) {
        await repo.upsertWorkingDraft({
          ref: document.ref,
          locale: null,
          snapshot: split.shared,
          createdBy,
          parts: SHARED_PART_ALONE,
        });
      }
      for (const [locale, values] of split.languages) {
        await repo.upsertWorkingDraft({
          ref: document.ref,
          locale,
          snapshot: values,
          createdBy,
          parts: { locales: [locale], shared: false },
        });
      }
    });
  }
  return planned.length;
}

/** What the dry run lists of the split: each document, and each conflict with its winner. */
export async function draftsSplitReport(
  context: UpgradeStepContext
): Promise<UpgradeReport> {
  const report: UpgradeReport = { move: [], conflicts: [], check: [] };
  for (const { document, split } of await plannedSplits(context)) {
    const { entity, ref } = document;
    const named = `the ${entity.kind} "${entity.slug}" entry ${ref.entryId}`;
    const shared = Object.keys(split.shared);
    report.move.push(
      `${named}: its pending changes kept by part` +
        (shared.length > 0 ? `, ${shared.join(", ")} to the shared draft` : "")
    );
    for (const conflict of split.conflicts) {
      report.conflicts.push(
        `${named}: ${conflict.field} changed in ${conflict.earlier} and ${conflict.later}; the later save (${conflict.later}) is kept`
      );
      report.check.push(
        `${named}: the shared ${conflict.field} now holds the ${conflict.later} change`
      );
    }
  }
  return report;
}
