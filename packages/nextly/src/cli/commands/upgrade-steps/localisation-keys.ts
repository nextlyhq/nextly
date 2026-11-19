/**
 * Giving every pending change its key: a working draft stored before pending changes were keyed
 * (`draft_key` NULL) gets the key its document and language make (`workingDraftKey`), the one the
 * database holds unique across pending changes.
 *
 * Without a key nothing kept two drafts of one language apart, so a document can hold several.
 * The later save is kept, as an editor last saw it; each earlier one is let go and listed in the
 * dry run for an editor to check. Once every draft has its key, the count of pending changes in a
 * language (`countPendingChangesIn`, which counts keyed drafts) sees every one of them.
 *
 * @module cli/commands/upgrade-steps/localisation-keys
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { LaidOutEntity } from "../../../domains/i18n/per-language-storage-layout";
import {
  WORKING_DRAFT_SHAPE,
  type VersionRef,
} from "../../../domains/versions/versions-repository";
import { workingDraftKey } from "../../../domains/versions/working-draft-key";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { UpgradeReport, UpgradeStepContext } from "../upgrade-step";

import {
  assertVersionHistoryReady,
  siteEntities,
  versionHistoryReady,
} from "./localisation-site";

/** A working draft as the step reads it. */
interface DraftRow {
  id: string;
  entryId: string;
  locale: string | null;
  draftKey: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

/** One document's pending changes in one language that need keying, or keeping one of. */
interface SlotToKey {
  entity: LaidOutEntity;
  ref: VersionRef;
  locale: string | null;
  /** The draft kept: the latest save. */
  kept: DraftRow;
  /** The earlier saves, let go. */
  earlier: DraftRow[];
}

/** When a draft was last saved, for keeping the later of two. */
function savedAt(row: DraftRow): number {
  const at = row.updatedAt ?? row.createdAt;
  return at === null || at === undefined ? 0 : new Date(at as string).getTime();
}

/** Each document's language whose pending changes lack their key or number more than one. */
async function slotsToKey(context: UpgradeStepContext): Promise<SlotToKey[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const slots: SlotToKey[] = [];
  // An earlier release's version history is keyed only once it is laid out as this one keeps it.
  await assertVersionHistoryReady(context);
  if (!(await versionHistoryReady(context))) return slots;
  for (const entity of await siteEntities(context)) {
    // Only collection entries and Singles keep pending changes.
    if (entity.kind === "component") continue;
    const rows = await adapter.select<DraftRow>(VERSIONS_TABLE, {
      columns: [
        "id",
        "entryId",
        "locale",
        "draftKey",
        "createdAt",
        "updatedAt",
      ],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: entity.kind },
          { column: "scopeSlug", op: "=", value: entity.slug },
          ...WORKING_DRAFT_SHAPE,
        ],
      },
    });
    const bySlot = new Map<string, DraftRow[]>();
    for (const row of rows) {
      const slot = JSON.stringify([row.entryId, row.locale]);
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), row]);
    }
    for (const drafts of bySlot.values()) {
      const [kept, ...earlier] = [...drafts].sort(
        (a, b) => savedAt(b) - savedAt(a)
      );
      if (!kept) continue;
      const ref: VersionRef = {
        scopeKind: entity.kind,
        scopeSlug: entity.slug,
        entryId: kept.entryId,
      };
      const keyed = kept.draftKey === workingDraftKey(ref, kept.locale);
      if (keyed && earlier.length === 0) continue;
      slots.push({ entity, ref, locale: kept.locale, kept, earlier });
    }
  }
  return slots;
}

/** How many documents' languages have pending changes to key. */
export async function draftsToKey(
  context: UpgradeStepContext
): Promise<number> {
  return (await slotsToKey(context)).length;
}

/** Key each pending change, letting each earlier save of one language go; how many were keyed. */
export async function keyPendingChanges(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const slots = await slotsToKey(context);
  for (const { ref, locale, kept, earlier } of slots) {
    // The earlier saves first, so the kept draft's key is never held by another row.
    await adapter.transaction(async tx => {
      for (const row of earlier) {
        await tx.delete(VERSIONS_TABLE, {
          and: [{ column: "id", op: "=", value: row.id }],
        });
      }
      await tx.update(
        VERSIONS_TABLE,
        { draftKey: workingDraftKey(ref, locale) },
        { and: [{ column: "id", op: "=", value: kept.id }] }
      );
    });
  }
  return slots.length;
}

/** What the dry run lists: each pending change keyed, and each earlier save let go. */
export async function draftKeysReport(
  context: UpgradeStepContext
): Promise<UpgradeReport> {
  const report: UpgradeReport = { move: [], conflicts: [], check: [] };
  for (const { entity, ref, locale, earlier } of await slotsToKey(context)) {
    const named = `the ${entity.kind} "${entity.slug}" entry ${ref.entryId}`;
    const language = locale ?? "its shared part";
    report.move.push(
      `${named}: its pending change in ${language} given its key`
    );
    for (const row of earlier) {
      report.check.push(
        `${named}: an earlier pending change in ${language}, saved ${new Date(savedAt(row)).toISOString()}, is let go; the later save is kept`
      );
    }
  }
  return report;
}
