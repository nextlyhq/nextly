/**
 * What a publish of every language does, judged before anything is written:
 * each language's pending change in the order it was saved, the languages
 * that go live as they are stored, the refusals a publish makes over shared
 * fields, and the one shared state the publish leaves.
 *
 * One implementation for every kind of document that publishes all its
 * languages at once, so each kind judges such a publish by the same rules. A
 * kind supplies only what is its own: the document's live values, read under
 * its lock, and how a refusal is named to its caller.
 *
 * @module domains/versions/publish-all-plan
 * @experimental
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { NextlyError, SharedFieldsConflictPublicData } from "../../errors";

import {
  differingFields,
  editedSharedFields,
  outOfDateSharedFields,
  sameSharedValue,
  sharedEditOrder,
  type SharedEditTime,
  type SharedViews,
  snapshotRecord,
} from "./shared-publish-base";
import { type VersionRef, VersionsRepository } from "./versions-repository";

/** One language's pending change, as the versions store holds it. */
export type PendingChange = Awaited<
  ReturnType<VersionsRepository["findAllWorkingDrafts"]>
>[number];

/**
 * Every language's pending change, in the order their languages last saved.
 * They are applied to one main row in this order, so where two changed one
 * shared field the later save's value is the one left, whatever order the
 * database returns the rows in.
 */
export async function pendingChangesInSaveOrder(
  db: TransactionContext | DrizzleAdapter,
  ref: VersionRef
): Promise<PendingChange[]> {
  const repo = new VersionsRepository(db);
  const drafts = await repo.findAllWorkingDrafts(ref);
  if (drafts.length < 2) return drafts;
  const newest = await repo.newestVersionNoByLocale(
    ref,
    drafts.map(draft => draft.locale)
  );
  const savedAt = (draft: PendingChange) => newest.get(draft.locale) ?? 0;
  return [...drafts].sort((a, b) => savedAt(a) - savedAt(b));
}

/** How a document carries its languages' statuses. */
export interface PublishableShape {
  /** Whether the MAIN row carries the draft/published lifecycle. */
  readonly hasMainStatus: boolean;
  /** Whether stored translations exist AND each carries its own status. */
  readonly translationsPublishable: boolean;
}

/** Each language's status as committed before this publish moved it. */
export interface PriorStatuses {
  /** The main row's, which is the whole document's for an unlocalized one. */
  readonly mainStatus: unknown;
  /** Each stored translation's `_status`, keyed by locale. */
  readonly companion: ReadonlyMap<string, string | null>;
}

/**
 * The languages this publish judges as stored, beside its pending changes:
 * those it puts live from their stored rows alone, and, when a pending change
 * may rewrite the shared values beneath them, those already live too. A
 * language that was live and is not touched was judged as published when it
 * went live, and a pending change is judged on its own account.
 *
 * The main row is one of them where nothing else carries it: shared content
 * goes live with the main row's status even where no translation is stored,
 * as on a document whose only edits were shared ones, so it is judged then too.
 */
export function languagesGoingLiveAsStored(
  shape: PublishableShape,
  pending: ReadonlyArray<{ locale: string | null }>,
  prior: PriorStatuses,
  /**
   * The languages the app configures. A removed language's row can outlive
   * it, and no request can reach it to repair, so it is not judged.
   */
  configured: ReadonlySet<string>
): { locale: string | null; snapshot: Record<string, never> }[] {
  const held = new Set(pending.map(change => change.locale));
  // A pending change can write shared values to the main row, which every
  // language's document reads, so a language already live is changed by it as
  // surely as one going live: with anything pending, every stored translation
  // is judged.
  const changesShared = pending.length > 0;
  const translations = shape.translationsPublishable
    ? [...prior.companion]
        .filter(
          ([locale, status]) =>
            !held.has(locale) &&
            (configured.size === 0 || configured.has(locale)) &&
            (changesShared || status !== "published")
        )
        .map(([locale]) => ({ locale, snapshot: {} }))
    : [];
  // Each of these is judged on the main row too, so it carries it already.
  if (translations.length > 0 || pending.length > 0) return translations;
  if (!shape.hasMainStatus || prior.mainStatus === "published") return [];
  return [{ locale: null, snapshot: {} }];
}

/** A refusal over shared fields, named as the publishing caller may read them. */
export type RefuseSharedFields = (refused: {
  fields: string[];
  live: Record<string, unknown>;
  reason?: SharedFieldsConflictPublicData["reason"];
}) => Promise<NextlyError>;

/** The document's shared values as they are live, read under its lock. */
export interface LiveSharedDocument {
  live: Record<string, unknown>;
  /** The fields every language shares. */
  shared: readonly string[];
  views: SharedViews;
  /**
   * Shared fields each language keeps its own copy of, such as a translated
   * component's shared parts: judged here but never merged.
   */
  byHand: ReadonlySet<string>;
}

/**
 * What a publish of every language finds over the shared fields, before it
 * writes or refuses anything. One verdict, read by the publish (which refuses
 * on it) and by its preview (which reports it), so what the preview says the
 * publish does is what the publish does.
 */
export interface SharedVerdict {
  /**
   * Each pending change behind live, keyed by its language, with the shared
   * fields someone else published after it began: the out-of-date change a
   * single publish refuses too, and nothing is merged on its behalf.
   */
  outOfDate: ReadonlyMap<string | null, readonly string[]>;
  /**
   * Shared parts of a component kept per language that a change edited, when
   * more than one language publishes. Each language's promotion writes its
   * own copy of the component, so whichever went last would undo the others'
   * edit, and the edit can't be merged into another language's instances
   * safely. Published one language at a time, the later one is out of date
   * and its editor copies the shared parts by hand.
   */
  unmergeable: readonly string[];
  /** Shared fields two changes edited whose order history can't prove. */
  unordered: readonly string[];
  /** The fields the publish merges: every shared one but those kept by hand. */
  merged: readonly string[];
  /**
   * The live shared values, each overlaid by the change that edited it last:
   * where two changes edited one field, the one whose edit of THAT field is
   * the later, from its language's version history, whichever language saved
   * anything last.
   */
  state: Record<string, unknown>;
}

/**
 * Judge the pending changes of a publish of every language over the shared
 * fields. Every change that is current began from the live shared values, and
 * each brings only the shared fields it edited itself, measured against its
 * own base. Combining the edits of changes that are all current is not the
 * field-by-field merge an out-of-date change is refused to avoid: no change is
 * behind live, so none of its values reverts another's.
 */
export async function judgeSharedValues(
  tx: TransactionContext,
  ref: VersionRef,
  pending: readonly PendingChange[],
  document: LiveSharedDocument
): Promise<SharedVerdict> {
  const { live, shared, views, byHand } = document;
  const outOfDate = new Map<string | null, readonly string[]>();
  for (const draft of pending) {
    const fields = await outOfDateSharedFields(tx, {
      ref,
      locale: draft.locale,
      shared,
      live,
      pending: snapshotRecord(draft.snapshot),
      views,
    });
    if (fields.length > 0) outOfDate.set(draft.locale, fields);
  }
  const unmergeable =
    pending.length < 2
      ? []
      : [...byHand].filter(name =>
          pending.some(draft => {
            const values = snapshotRecord(draft.snapshot);
            return (
              name in values &&
              differingFields([name], values, live, views).length > 0
            );
          })
        );
  // A translated component's shared parts are judged above but not merged:
  // each language's component also holds its own translated values, so it
  // goes live as that language saved it.
  const merged = shared.filter(name => !byHand.has(name));
  const { state, unordered } = await mergedSharedState(tx, ref, pending, {
    live,
    shared: merged,
  });
  return { outOfDate, unmergeable, unordered, merged, state };
}

/**
 * The pending changes as a publish of every language writes them, each
 * carrying the one shared state the publish leaves, or the refusal its verdict
 * calls for. Refused first, naming every field, when any change is out of
 * date; then over shared parts that can't be merged; then over edits whose
 * order history can't prove, which is never decided by a guess. Every change
 * is written with the same shared state, so the order the rows are applied in
 * no longer decides it.
 */
export async function sharedStateForPublish(
  tx: TransactionContext,
  ref: VersionRef,
  pending: readonly PendingChange[],
  document: LiveSharedDocument,
  refuse: RefuseSharedFields
): Promise<PendingChange[]> {
  if (pending.length === 0) return [];
  const verdict = await judgeSharedValues(tx, ref, pending, document);
  const { live } = document;
  const stale = new Set([...verdict.outOfDate.values()].flat());
  if (stale.size > 0) throw await refuse({ fields: [...stale], live });
  if (verdict.unmergeable.length > 0) {
    throw await refuse({
      fields: [...verdict.unmergeable],
      live,
      reason: "shared-edits-unmergeable",
    });
  }
  if (verdict.unordered.length > 0) {
    throw await refuse({
      fields: [...verdict.unordered],
      live,
      reason: "shared-edits-unordered",
    });
  }
  return pending.map(draft =>
    withSharedState(draft, verdict.merged, verdict.state)
  );
}

/** Shared fields as the caller may read them: the others are counted, never named. */
export interface NamedFields {
  fields: string[];
  hiddenCount?: number;
}

/**
 * What a publish of every language does to one configured language. Exactly
 * one, the first that applies in this order: a pending change behind live
 * refuses the publish; a pending change goes live; a language already live
 * stays as it is; a language with content of its own goes live; and a
 * language with none goes live showing the first language it falls back to
 * that has content, or nothing where fallback is off.
 */
export type LanguageOutcome =
  | ({ locale: string; outcome: "out-of-date" } & NamedFields)
  | { locale: string; outcome: "goes-live-with-pending-change" }
  | { locale: string; outcome: "stays-published" }
  | { locale: string; outcome: "goes-live" }
  | { locale: string; outcome: "shows-fallback"; fallback: string | null };

/** What refuses a publish of every language as a whole, whichever languages it reaches. */
export type PublishAllBlocker = {
  reason: "shared-edits-unmergeable" | "shared-edits-unordered";
} & NamedFields;

/** A verdict's fields named as the caller may read them. */
export interface NamedVerdict {
  outOfDate: ReadonlyMap<string | null, NamedFields>;
  blockers: PublishAllBlocker[];
}

/**
 * Name a verdict's fields through the caller's field read rules, as a refusal
 * of the publish names them.
 */
export async function nameVerdict(
  verdict: SharedVerdict,
  name: (
    fields: readonly string[]
  ) => Promise<{ named: string[]; hidden: number }>
): Promise<NamedVerdict> {
  const named = async (fields: readonly string[]): Promise<NamedFields> => {
    const { named: readable, hidden } = await name(fields);
    return { fields: readable, ...(hidden > 0 ? { hiddenCount: hidden } : {}) };
  };
  const outOfDate = new Map<string | null, NamedFields>();
  for (const [locale, fields] of verdict.outOfDate) {
    outOfDate.set(locale, await named(fields));
  }
  const blockers: PublishAllBlocker[] = [];
  if (verdict.unmergeable.length > 0) {
    blockers.push({
      reason: "shared-edits-unmergeable",
      ...(await named(verdict.unmergeable)),
    });
  }
  if (verdict.unordered.length > 0) {
    blockers.push({
      reason: "shared-edits-unordered",
      ...(await named(verdict.unordered)),
    });
  }
  return { outOfDate, blockers };
}

/** Each configured language's outcome, in the order the app configures them. */
export function languageOutcomes(args: {
  configured: readonly string[];
  /** The languages holding a pending change. */
  pending: ReadonlySet<string | null>;
  outOfDate: NamedVerdict["outOfDate"];
  /** Each stored translation's status before the publish. */
  prior: ReadonlyMap<string, string | null>;
  /** Whether a language has content of its own, as reads judge it. */
  hasOwnContent: (locale: string) => boolean;
  /**
   * The languages a language without content falls back through, itself
   * first; null when fallback is off.
   */
  fallbackChain: (locale: string) => readonly string[] | null;
}): LanguageOutcome[] {
  return args.configured.map((locale): LanguageOutcome => {
    const stale = args.outOfDate.get(locale);
    if (stale) return { locale, outcome: "out-of-date", ...stale };
    if (args.pending.has(locale)) {
      return { locale, outcome: "goes-live-with-pending-change" };
    }
    if (args.prior.get(locale) === "published") {
      return { locale, outcome: "stays-published" };
    }
    if (args.hasOwnContent(locale)) return { locale, outcome: "goes-live" };
    const chain = args.fallbackChain(locale);
    const fallback =
      chain?.find(code => code !== locale && args.hasOwnContent(code)) ?? null;
    return { locale, outcome: "shows-fallback", fallback };
  });
}

/** One language's edit of a shared field, and when it was made. */
interface SharedEdit extends SharedEditTime {
  value: unknown;
}

/**
 * The live shared values, each overlaid by the change that edited it last,
 * and the fields whose edits history can no longer order.
 */
async function mergedSharedState(
  tx: TransactionContext,
  ref: VersionRef,
  pending: readonly PendingChange[],
  document: { live: Record<string, unknown>; shared: readonly string[] }
): Promise<{ state: Record<string, unknown>; unordered: string[] }> {
  const { live, shared } = document;
  const edits = new Map<string, SharedEdit[]>();
  for (const draft of pending) {
    const values = snapshotRecord(draft.snapshot);
    const edited = await editedSharedFields(tx, {
      ref,
      locale: draft.locale,
      shared,
      pending: values,
    });
    const order = await sharedEditOrder(tx, {
      ref,
      locale: draft.locale,
      fields: edited,
      pending: values,
    });
    for (const name of edited) {
      const time = order.get(name) ?? { after: 0, by: 0 };
      edits.set(name, [
        ...(edits.get(name) ?? []),
        { value: values[name], ...time },
      ]);
    }
  }
  const state: Record<string, unknown> = Object.fromEntries(
    shared.map(name => [name, live[name]])
  );
  const unordered: string[] = [];
  for (const [name, candidates] of edits) {
    const winner = latestEdit(candidates);
    if (winner) state[name] = winner.value;
    else unordered.push(name);
  }
  return { state, unordered };
}

/**
 * The edit history proves later than every edit of another value, or null
 * when none is: two edits whose times overlap can't be ordered.
 */
function latestEdit(edits: readonly SharedEdit[]): SharedEdit | null {
  return (
    edits.find(edit =>
      edits.every(
        other =>
          other === edit ||
          sameSharedValue(other.value, edit.value) ||
          edit.after >= other.by
      )
    ) ?? null
  );
}

/** A pending change carrying the one shared state a publish of every language leaves. */
function withSharedState(
  draft: PendingChange,
  shared: readonly string[],
  state: Record<string, unknown>
): PendingChange {
  const values = snapshotRecord(draft.snapshot);
  return {
    ...draft,
    snapshot: {
      ...values,
      ...Object.fromEntries(
        shared.filter(name => name in values).map(name => [name, state[name]])
      ),
    },
  };
}
