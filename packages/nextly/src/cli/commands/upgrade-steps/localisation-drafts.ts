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
 * A repeater or group that keeps one structure across languages is split too: the text inside
 * becomes the language's draft, keyed by row id, and the structure becomes part of the shared
 * draft where it differs from the live one. A group holding only text, at its own level and in
 * every group inside, reads the same held whole as its text alone; where the document has no
 * structure for it yet (none live, none in a draft kept under no language), a language's draft
 * holding its text is split as whole, so the group it brings into being is the shared draft's.
 * Once split, the shared draft holds that structure, so a run again finds nothing to split.
 *
 * @module cli/commands/upgrade-steps/localisation-drafts
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { storesPerLanguage } from "../../../domains/i18n/per-language-storage";
import type { LaidOutEntity } from "../../../domains/i18n/per-language-storage-layout";
import {
  holdsText,
  holdsUnkeyedText,
  isWholeValue,
  sameStructure,
  splitSharedStructure,
  type SharedStructureShape,
  type StructuredField,
} from "../../../domains/i18n/shared-structure";
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
import {
  NOTHING_CHANGED,
  type UpgradeReport,
  type UpgradeStepContext,
} from "../upgrade-step";

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
  /**
   * The groups the document has no structure for yet, none live and none in a draft kept under no
   * language, that a language's draft holds text in: that draft holds the group whole.
   */
  structureless: ReadonlySet<string>;
}

/** Whether `snapshot` holds any of `keys`. */
function holdsAny(
  snapshot: Record<string, unknown>,
  keys: ReadonlySet<string>
): boolean {
  return Object.keys(snapshot).some(key => keys.has(key));
}

/**
 * Whether a draft's value of a structured field holds more than its part: a language's draft
 * holding the field's whole value, or one kept under no language holding its text.
 */
function structuredKeptWhole(
  locale: string | null,
  value: unknown,
  shape: SharedStructureShape
): boolean {
  return locale === null ? holdsText(value, shape) : isWholeValue(value, shape);
}

/**
 * Whether a working draft holds more than its part: a language's draft holding a shared value,
 * or one kept under no language holding a language's value, or either holding more than its
 * share of a structured field.
 */
function keptWhole(draft: VersionRow, keys: PartKeys): boolean {
  const snapshot = snapshotRecord(draft.snapshot);
  const structuredWhole = [...keys.structured].some(
    ([key, shape]) =>
      Object.hasOwn(snapshot, key) &&
      structuredKeptWhole(draft.locale, snapshot[key], shape)
  );
  return (
    structuredWhole ||
    (draft.locale === null
      ? holdsAny(snapshot, keys.language)
      : holdsAny(snapshot, keys.shared))
  );
}

/**
 * The groups of one document (`DocumentToSplit.structureless`) a language's draft holds text in
 * while the document has no structure for them: none in a draft kept under no language, and none
 * on its live row. The live row is read only where a draft holds such text.
 */
async function structurelessGroups(
  adapter: DrizzleAdapter,
  document: Pick<DocumentToSplit, "entity" | "keys" | "ref">,
  drafts: readonly VersionRow[]
): Promise<Set<string>> {
  const snapshots = drafts.map(draft => ({
    locale: draft.locale,
    snapshot: snapshotRecord(draft.snapshot),
  }));
  const candidates = [...document.keys.structured]
    .filter(
      ([key, shape]) =>
        shape.kind === "group" &&
        !snapshots.some(
          ({ locale, snapshot }) =>
            locale === null && Object.hasOwn(snapshot, key)
        ) &&
        snapshots.some(
          ({ locale, snapshot }) =>
            locale !== null &&
            Object.hasOwn(snapshot, key) &&
            holdsText(snapshot[key], shape)
        )
    )
    .map(([key]) => key);
  if (candidates.length === 0) return new Set();
  const live = await liveRowOf(adapter, document);
  return new Set(
    candidates.filter(key => {
      const column = toSnakeCase(key);
      // No live row or column to judge by: nothing is guessed, the draft is read as it is.
      return (
        live !== undefined &&
        column in live &&
        sameStructure(live[column], null)
      );
    })
  );
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
  const entities = await siteEntities(context);
  // The site's components, by slug: a component field is split by part as the running site
  // splits it, its instances to the shared draft and their text to the language's.
  const components = new Map(
    entities
      .filter(entity => entity.kind === "component")
      .map(entity => [entity.slug, entity.fields as readonly StructuredField[]])
  );
  for (const entity of entities) {
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
      components: slug => components.get(slug),
    });
    const byEntry = new Map<string, VersionRow[]>();
    for (const draft of drafts) {
      byEntry.set(draft.entryId, [
        ...(byEntry.get(draft.entryId) ?? []),
        draft,
      ]);
    }
    for (const [entryId, entryDrafts] of byEntry) {
      const ref = { scopeKind: entity.kind, scopeSlug: entity.slug, entryId };
      const structureless = await structurelessGroups(
        adapter,
        { entity, keys, ref },
        entryDrafts
      );
      if (
        structureless.size === 0 &&
        !entryDrafts.some(draft => keptWhole(draft, keys))
      ) {
        continue;
      }
      found.push({ entity, keys, ref, drafts: entryDrafts, structureless });
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
  /** Each field a draft holds text in on a row or instance with no id, as `field (language)`. */
  unkeyed: string[];
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
  const structured = document.keys.structured.has(key);
  if (!document.keys.shared.has(key) && !structured) return false;
  if (alreadyShared || !live) return true;
  const column = toSnakeCase(key);
  if (!(column in live)) return true;
  // A structure is compared as a structure (`sameStructure`): a blank value inside reads as an
  // absent one, and a structure coming to be is a change even while it holds nothing.
  return structured
    ? !sameStructure(live[column], value)
    : !sameSharedValue(live[column], value);
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
  unkeyed: string[];
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

/**
 * A held value of `key` as a shared edit judges it: for a structured field, its text goes to the
 * language's draft, by row id, and its structure is returned to be judged as a shared value is;
 * any other field's value as it is. `undefined` where nothing is left to judge: a language's draft
 * already holding the text alone keeps it whole as that language's.
 */
function structureOfDraftValue(
  state: SplitState,
  document: DocumentToSplit,
  draft: VersionRow,
  slot: string,
  key: string,
  held: unknown
): unknown {
  const shape = document.keys.structured.get(key);
  if (!shape) return held;
  // The language's text, kept as a language value is: two drafts saved at one moment for one
  // language that hold different text is a tie the order rows are read in would settle.
  const keepText = (text: unknown) => {
    const tie = languageValueTie(state.languageOrigins, slot, key, text, draft);
    if (tie) state.ties.push(tie);
    state.languages.set(slot, { ...state.languages.get(slot), [key]: text });
  };
  // A group the document has no structure for is held whole by a language's draft holding its
  // text (`structureless`), though it reads the same as its text alone.
  if (
    draft.locale !== null &&
    !structuredKeptWhole(draft.locale, held, shape) &&
    !document.structureless.has(key)
  ) {
    keepText(held);
    return undefined;
  }
  // Text on a row or component instance with no id cannot be filed by row: a split leaves it on
  // the structure, the shared draft's, where any language's publish would take it live. An earlier
  // release kept no id on an instance held inline, so such a draft is refused rather than guessed
  // at by position: its rows need not be the live row's.
  if (holdsUnkeyedText(held, shape)) {
    state.unkeyed.push(`${key} (${draft.locale ?? "no language"})`);
  }
  const split = splitSharedStructure(held, shape);
  if (split.overlay !== undefined) keepText(split.overlay);
  return split.structure;
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
  // One holding the text of a structured field is a whole document's, as one holding a
  // language's value is.
  const alreadyShared =
    draft.locale === null &&
    !holdsAny(snapshot, document.keys.language) &&
    ![...document.keys.structured].some(
      ([key, shape]) =>
        Object.hasOwn(snapshot, key) && holdsText(snapshot[key], shape)
    );
  const slot = draft.locale ?? defaultLocale;
  for (const [key, held] of Object.entries(snapshot)) {
    if (document.keys.language.has(key)) {
      const tie = languageValueTie(
        state.languageOrigins,
        slot,
        key,
        held,
        draft
      );
      if (tie) state.ties.push(tie);
      state.languages.set(slot, { ...state.languages.get(slot), [key]: held });
      continue;
    }
    const value = structureOfDraftValue(
      state,
      document,
      draft,
      slot,
      key,
      held
    );
    if (value === undefined) continue;
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
    unkeyed: [],
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
    unkeyed: state.unkeyed,
  };
}

/**
 * The live row of `document`, by column: the columns of its shared fields that its main table
 * has, read through a statement since the upgrade's connection registers no content tables.
 * Nothing where the document has no row, or none of those columns.
 */
async function liveRowOf(
  adapter: DrizzleAdapter,
  document: Pick<DocumentToSplit, "entity" | "keys" | "ref">
): Promise<Record<string, unknown> | undefined> {
  const { tables } = await introspectLiveColumns(
    adapter.getDrizzle(),
    adapter.dialect,
    [document.entity.tableName]
  );
  const present = new Set(
    (tables[0]?.columns ?? []).map(column => column.name)
  );
  const columns = [...document.keys.shared, ...document.keys.structured.keys()]
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
 * came later, so neither is kept on a guess. Refused too where a draft holds text inside a repeater
 * or group on a row or component instance with no id (`holdsUnkeyedText`), which no split can file
 * under its language. The count, the run and the dry run read this one plan.
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
  const unkeyed = planned.flatMap(({ document, split }) =>
    split.unkeyed.length === 0
      ? []
      : [
          `the ${document.entity.kind} "${document.entity.slug}" entry ${document.ref.entryId} ` +
            `(${split.unkeyed.join(", ")})`,
        ]
  );
  if (unkeyed.length > 0) {
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED",
      publicMessage:
        `Pending changes hold translated text on repeater rows or component instances with no id ` +
        `for ${unkeyed.join("; ")}, so that text cannot be kept by row for its language. ` +
        "Publish or discard these pending changes, then run `nextly migrate` again. " +
        NOTHING_CHANGED,
      logContext: { unkeyed },
    });
  }
  if (tied.length > 0) {
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED",
      publicMessage:
        `Pending changes to one field were saved at the same moment for ${tied.join("; ")}, so ` +
        "which change came later cannot be told. Give the field the same value in those pending " +
        "changes, or discard one of them, then run `nextly migrate` again. " +
        NOTHING_CHANGED,
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
