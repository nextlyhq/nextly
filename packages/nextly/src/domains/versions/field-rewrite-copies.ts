/**
 * What a field rewrite does to a document's copies, whichever write path holds
 * the document's row lock: each copy's new value decided before any is
 * written, each draft saved as a save of it is, the shared bases of the
 * language drafts moved with the live value, and the history event that names
 * the rewrite.
 *
 * A collection entry and a Single store their live copies differently, so
 * each write path reads and writes its own live copy. Everything about the
 * drafts and the history is the same for both, and lives here once.
 *
 * @module domains/versions/field-rewrite-copies
 * @experimental
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";
import { isFieldGroupField } from "../../collections/fields/guards";
import type {
  FieldGroupReach,
  NamedField,
} from "../../shared/lib/password-fields";
import { assignRepeaterRowIds } from "../../shared/lib/repeater-row-ids";
import { NextlyError } from "../../errors";
import { pathsKeptFromCaller } from "../../shared/lib/denied-change";
import type { WriteEventInput } from "../content-events/write-event";
import { keepDeniedAtStoredOnUpdate } from "../field-groups/field-group-write-access";

import { storeDraftSave } from "./draft-save";
import {
  draftSlotsHolding,
  draftSlotsOf,
  copyLabel,
  copyWords,
  rewrittenValue,
  type DraftSlot,
  type FieldRewriteCopy,
  type FieldRewriteValue,
} from "./field-rewrite";
import { combinedDraft, draftsKeptByPart, findPartDrafts } from "./part-drafts";
import {
  outOfDateSharedFields,
  recordSharedBase,
  sameSharedValue,
  type SharedViews,
} from "./shared-publish-base";
import type { VersionCaptureService } from "./version-capture-service";
import {
  VersionsRepository,
  type VersionRef,
  type VersionRow,
} from "./versions-repository";

/**
 * The live copy as a rewrite compares it with the language drafts: its shared
 * fields, the view some are compared through, and the document as a version
 * snapshot holds it.
 */
export interface RewriteLiveShared {
  shared: readonly string[];
  views: SharedViews;
  document: Record<string, unknown>;
}

/** Each copy's new value, decided before any copy is written. */
export interface RewriteCopiesDecided {
  liveCopy: FieldRewriteCopy;
  liveValue: unknown;
  /** Whether the live value moves; `drafts` holds only those that do. */
  liveChanges: boolean;
  drafts: { slot: DraftSlot; value: unknown }[];
  /**
   * Every draft holding the field, moved or not: a draft whose own value
   * stays still had its base against a live value that may move.
   */
  held: DraftSlot[];
}

/**
 * Each copy's new value: the live copy's and that of every draft holding the
 * field, each judged by `allowed` before any copy is written, so one that
 * fails leaves every copy as it was. A copy whose value the rewrite leaves as
 * it was is neither judged nor written: it keeps its copy, its date and its
 * events as they were.
 */
export async function decideRewriteCopies(args: {
  set: FieldRewriteValue;
  field: string;
  /** The language a translated field is rewritten in; null for a shared one. */
  translatedIn: string | null;
  /** The field's current live value. */
  liveValue: unknown;
  /** Every working draft the document holds. */
  workingDrafts: readonly VersionRow[];
  /** Refuses a copy's new value, judged against the value it replaces. */
  allowed: (
    copy: FieldRewriteCopy,
    value: unknown,
    current: unknown
  ) => Promise<void>;
  /**
   * A new value as the copy stores it, where the write path reduces what it
   * is given (a populated reference to its id): compared, judged and written
   * in that form, so a value that stores as it was changes nothing.
   */
  stored?: (value: unknown) => unknown;
}): Promise<RewriteCopiesDecided> {
  const { set, field, translatedIn } = args;
  const stored = args.stored ?? ((value: unknown) => value);
  const held = draftSlotsHolding(
    draftSlotsOf(args.workingDrafts),
    field,
    translatedIn === null ? null : { locale: translatedIn }
  );
  const liveCopy: FieldRewriteCopy = { form: "live", locale: translatedIn };
  const liveValue = stored(await rewrittenValue(set, args.liveValue, liveCopy));
  const liveChanges = !sameSharedValue(liveValue, args.liveValue);
  if (liveChanges) await args.allowed(liveCopy, liveValue, args.liveValue);
  const drafts: { slot: DraftSlot; value: unknown }[] = [];
  for (const slot of held) {
    const copy: FieldRewriteCopy = { form: "draft", locale: slot.locale };
    const current = slot.snapshot[field];
    const value = stored(await rewrittenValue(set, current, copy));
    if (sameSharedValue(value, current)) continue;
    await args.allowed(copy, value, current);
    drafts.push({ slot, value });
  }
  return { liveCopy, liveValue, liveChanges, drafts, held };
}

/**
 * Refuse a copy's new value that the field rules keep from the person a
 * rewrite is made for, judged as an update of that copy is: against the value
 * it replaces, not the new value alone. A group or repeater is written whole,
 * so a replacement that leaves out a child the person may not change would
 * otherwise delete it. The rules put each such value back from the copy, and
 * a rewrite never writes something other than what it was asked to: any value
 * kept from the person, or changed by a rule, refuses it with `FORBIDDEN`,
 * naming each protected field and the copy. Nothing is written.
 */
export async function refuseRewriteKeptByFieldRules(args: {
  field: string;
  /** The copy's new value, as the write stores it. */
  written: unknown;
  /** The value it replaces, in the same form. */
  current: unknown;
  copy: FieldRewriteCopy;
  /** The update's field rules, as the write path applies them to a save. */
  rules: Omit<
    Parameters<typeof keepDeniedAtStoredOnUpdate>[0],
    "data" | "stored"
  >;
  logContext: Record<string, unknown>;
}): Promise<void> {
  const { field, written, copy } = args;
  const sent: Record<string, unknown> = { [field]: structuredClone(written) };
  const probe: Record<string, unknown> = { [field]: structuredClone(written) };
  const kept = await keepDeniedAtStoredOnUpdate({
    ...args.rules,
    data: probe,
    stored: { [field]: structuredClone(args.current) },
  });
  if (Object.hasOwn(probe, field) && sameSharedValue(probe[field], written)) {
    return;
  }
  // The values kept from the person, each by its path; the field itself
  // where a rule refuses or changes it whole.
  const named = Object.hasOwn(probe, field)
    ? pathsKeptFromCaller(
        { paths: kept.storedPaths, values: kept.storedValues },
        sent
      )
    : [];
  const paths = named.length > 0 ? named : [field];
  throw NextlyError.forbidden({
    publicData: {
      errors: paths.map(path => ({
        path,
        code: "FORBIDDEN",
        message: `You do not have permission to change this field (the ${copyWords(copy)}).`,
        ...(copy.locale === null ? {} : { locale: copy.locale }),
      })),
    },
    logContext: {
      ...args.logContext,
      reason: "field-rewrite-field-rule",
      field,
      paths,
    },
  });
}

/** Every copy a decided rewrite changes, the live copy first. */
export function rewrittenCopies(
  decided: Pick<RewriteCopiesDecided, "liveCopy" | "liveChanges" | "drafts">
): FieldRewriteCopy[] {
  return [
    ...(decided.liveChanges ? [decided.liveCopy] : []),
    ...decided.drafts.map(({ slot }) => ({
      form: "draft" as const,
      locale: slot.locale,
    })),
  ];
}

/**
 * Whether the language drafts' shared bases follow the live value a rewrite
 * moves: only for a shared field of a document with languages, whose drafts
 * each hold the whole document (not where drafts are kept by part).
 */
function basesFollowLive(args: {
  localized: boolean;
  translatedIn: string | null;
}): boolean {
  return args.localized && !draftsKeptByPart() && args.translatedIn === null;
}

/**
 * For each language's pending change, whether it was already behind the live
 * shared values on a field other than the one rewritten. Read before the live
 * copy moves; see {@link moveRewrittenDraftBases}.
 */
export async function draftsBehindLive(
  tx: TransactionContext,
  args: {
    localized: boolean;
    field: string;
    translatedIn: string | null;
    ref: VersionRef;
    liveBefore: RewriteLiveShared;
    slots: readonly DraftSlot[];
  }
): Promise<Map<string, boolean>> {
  const behind = new Map<string, boolean>();
  if (!basesFollowLive(args)) return behind;
  for (const slot of args.slots) {
    if (slot.locale === null) continue;
    const stale = await outOfDateSharedFields(tx, {
      ref: args.ref,
      locale: slot.locale,
      shared: args.liveBefore.shared,
      live: args.liveBefore.document,
      pending: slot.snapshot,
      views: args.liveBefore.views,
    });
    behind.set(
      slot.locale,
      stale.some(name => name !== args.field)
    );
  }
  return behind;
}

/**
 * Move each rewritten language draft's shared base to the live copy as the
 * rewrite left it, where nothing else held it back.
 *
 * A language's pending change that already held this field's live value, or
 * was edited only where the live copy did not move, publishes cleanly against
 * its base. One that held its own edit of the field now holds the rewrite of
 * that edit, which differs from the rewritten live value: its base moves to
 * the version just recorded, so its next publish puts its own value live
 * rather than being refused for disagreeing with live. A change that was
 * already behind on another field keeps its base: moving it would make that
 * field's old value look current.
 */
export async function moveRewrittenDraftBases(
  tx: TransactionContext,
  args: {
    localized: boolean;
    translatedIn: string | null;
    ref: VersionRef;
    slots: readonly DraftSlot[];
    behindBefore: ReadonlyMap<string, boolean>;
    liveAfter: RewriteLiveShared;
  }
): Promise<void> {
  if (!basesFollowLive(args)) return;
  for (const slot of args.slots) {
    if (slot.locale === null || args.behindBefore.get(slot.locale) !== false) {
      continue;
    }
    await recordSharedBase(tx, {
      ref: args.ref,
      locale: slot.locale,
      shared: args.liveAfter.shared,
      live: args.liveAfter.document,
      views: args.liveAfter.views,
    });
  }
}

/**
 * Save a draft's new value as a save of that draft is saved: the draft keeps
 * its author, and a version of it is recorded as made by whoever rewrote it.
 * Where drafts are kept by part, the row is the part and the version is the
 * whole document in that part's language, as a held save records it. Answers
 * the version recorded, or null where the draft's content did not change.
 */
export async function saveRewrittenDraft(
  tx: TransactionContext,
  capture: VersionCaptureService,
  draft: {
    ref: VersionRef;
    field: string;
    fields: readonly NamedField[];
    /** Where a repeater's row ids are followed through inline field groups. */
    reach: FieldGroupReach;
    slot: DraftSlot;
    value: unknown;
    /** The live copy as the rewrite left it, which a part draft completes. */
    liveAfter: Record<string, unknown>;
    maxPerDoc: number | false | undefined;
    /** Who rewrote it, recorded on the version. */
    rewrittenBy: string | null;
    /**
     * The language a version of a draft kept under no language is recorded
     * in, where it carries a field group: that group's own.
     */
    componentLocale: string | null;
  }
): Promise<number | null> {
  const { field, slot, ref } = draft;
  // Repeater rows keep their ids against what this draft held, as the live
  // write's rows do against the live copy: a row without one gets a fresh id,
  // and history matches rows by them.
  const shaped: Record<string, unknown> = {
    [field]: structuredClone(draft.value),
  };
  assignRepeaterRowIds(
    shaped,
    { [field]: slot.snapshot[field] },
    draft.fields,
    draft.reach
  );
  const patched = { ...slot.snapshot, [field]: shaped[field] };
  let snapshot = patched;
  let replaces = slot.snapshot;
  if (draftsKeptByPart()) {
    // The whole document the drafts describe in this part's language, as its
    // next read assembles it, with and without the new value.
    const whole = combinedDraft(
      draft.liveAfter,
      await findPartDrafts(new VersionsRepository(tx), ref, slot.locale)
    );
    snapshot = { ...whole, [field]: shaped[field] };
    replaces = { ...whole, [field]: slot.snapshot[field] };
  }
  const { versionNo } = await storeDraftSave(tx, capture, {
    ref,
    locale: slot.locale,
    // Keyed as a held save keys its version: where the document has no
    // languages and the draft carries a field group, under the language that
    // group was read in, so a restore of it keeps the group.
    versionLocale:
      slot.locale ??
      (draft.fields.some(
        f =>
          isFieldGroupField(f) &&
          f.name !== undefined &&
          snapshot[f.name] != null
      )
        ? draft.componentLocale
        : null),
    snapshot,
    replaces,
    createdBy: draft.rewrittenBy,
    maxPerDoc: draft.maxPerDoc,
    storeWorkingDraft: repo =>
      repo.upsertWorkingDraft({
        ref,
        locale: slot.locale,
        snapshot: patched,
        createdBy: slot.createdBy,
      }),
  });
  return versionNo;
}

/**
 * The history event a rewrite records: of its own kind, naming the field,
 * each copy changed and the reason, never an overwrite. A plugin acting as the
 * system is the event's actor; one acting for a person is named beside them.
 */
export function fieldRewriteEvent(args: {
  field: string;
  copies: readonly FieldRewriteCopy[];
  reason: string;
  actor: RequestActor;
  personName: string | null;
  /** The plugin making it, by the name it booted under, when one is. */
  plugin: string | undefined;
  versionNo: number | null;
  localized: boolean;
  translatedIn: string | null;
}): Omit<WriteEventInput, "subject"> {
  const { actor, plugin, translatedIn } = args;
  const byPlugin = plugin !== undefined;
  return {
    kind: "fieldRewritten",
    actor,
    personName: args.personName,
    ...(byPlugin && actor.type === "system" ? { plugin } : {}),
    note: args.reason,
    versionNo: args.versionNo,
    ...(args.localized
      ? {
          parts:
            translatedIn === null
              ? { shared: true }
              : { locales: [translatedIn] },
        }
      : {}),
    payload: {
      field: args.field,
      copies: args.copies.map(copyLabel),
      ...(byPlugin && actor.type !== "system" ? { plugin } : {}),
    },
  };
}
