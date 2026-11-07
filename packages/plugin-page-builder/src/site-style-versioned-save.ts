/**
 * One Design section saved onto the newest stored copy, whatever saved the
 * Site Style in between.
 *
 * Each try merges the author's section onto the section as the newest read
 * holds it (`site-style-merge`) and writes the merge with THAT read's
 * version, so a save made in between refuses it rather than being
 * overwritten. A refusal reads again and merges again, as many times as
 * `attemptUntilFresh` allows. The section and its version always come from
 * one answer, a read or a write's response: a section paired with a version
 * it did not come with would make the check pass over a save it never saw.
 *
 * Transport-agnostic: the reading, writing and recognising of a refusal are
 * handed in, so the editor's client and a server-side caller run this one
 * loop.
 *
 * @module site-style-versioned-save
 */
import { withVersionFrom } from "./document-version";
import {
  mergeSiteStyleSection,
  type EntryConflict,
  type MergeableSection,
  type MergeWinner,
} from "./site-style-merge";
import { attemptUntilFresh } from "./stale-attempts";

/** The stored document, and the version the same answer gave it. */
export interface VersionedSiteStyle {
  readonly doc: unknown;
  readonly rev: string | undefined;
}

/** Who made the save a refusal names, as the Single answers it. */
export interface StaleChanger {
  /** The name shown for them now, or `null` where there is none. */
  readonly name: string | null;
  readonly kind?: string;
}

/** What a stale refusal says, read from its public data. */
interface StaleRefusal {
  /** The version stored when the write was refused. */
  readonly currentVersion?: string;
  /** Who made it, for a caller allowed to read the document. */
  readonly changedBy?: StaleChanger;
}

/**
 * The true conflicts a save settled, and what is known of who caused them.
 * Drawn by the editor in words; this module says only what happened.
 */
export interface SaveConflicts {
  readonly entries: readonly EntryConflict[];
  /**
   * From the refusals that sent the save back to read again, when any did:
   * whether the conflicts are all the doing of one save, the one a single
   * refusal named, made just after the version this save was first sent
   * with, and then who made it. Otherwise `oneSaveBetween` is false and no
   * one is named: someone else may have changed the entries.
   */
  readonly refusal?: {
    readonly changedBy?: StaleChanger;
    readonly oneSaveBetween: boolean;
  };
}

/** How one section save is made. */
export interface VersionedSectionSave {
  readonly section: MergeableSection;
  /** The section as the author's value was built from. */
  readonly base: unknown;
  /** The author's section. */
  readonly mine: unknown;
  /** Whose value a true conflict keeps: mine for a save, theirs for a replay. */
  readonly prefer: MergeWinner;
  /** The newest stored copy in hand, used for the first try. */
  readonly latest: VersionedSiteStyle;
  /** A fresh read of the stored document, never a cached one. */
  readonly read: () => Promise<VersionedSiteStyle>;
  /**
   * Write the section's data (the section and the version it was merged
   * onto), answering the document as stored after it.
   */
  readonly write: (
    data: Record<string, unknown>
  ) => Promise<VersionedSiteStyle>;
  /** The refusal's public data when a failure is a stale refusal, else `undefined`. */
  readonly staleOf: (error: unknown) => unknown;
}

/** What a stored section save came to. */
export interface VersionedSectionSaved {
  /** The section as written: the merge. */
  readonly stored: unknown;
  /** The section as stored just before the write, which an undo puts back. */
  readonly replaced: unknown;
  /** The document as the write answered it. */
  readonly latest: VersionedSiteStyle;
  /** The true conflicts settled, when there were any. */
  readonly conflicts?: SaveConflicts;
  /** How many writes were sent. */
  readonly attempts: number;
}

/** A section as a stored document holds it, or `null` when it holds none. */
export function sectionOf(doc: unknown, section: string): unknown {
  if (typeof doc !== "object" || doc === null) return null;
  return (doc as Record<string, unknown>)[section] ?? null;
}

/** A refusal's public data, read as far as it can be. */
function staleRefusalOf(data: unknown): StaleRefusal {
  if (typeof data !== "object" || data === null) return {};
  const { currentVersion, changedBy } = data as Record<string, unknown>;
  const by =
    typeof changedBy === "object" && changedBy !== null
      ? (changedBy as Record<string, unknown>)
      : undefined;
  return {
    ...(typeof currentVersion === "string" ? { currentVersion } : {}),
    ...(by === undefined
      ? {}
      : {
          changedBy: {
            name: typeof by.name === "string" ? by.name : null,
            ...(typeof by.kind === "string" ? { kind: by.kind } : {}),
          },
        }),
  };
}

/** A version as the counter it is for this Single, or `undefined`. */
export function revisionNumber(rev: string | undefined): number | undefined {
  if (rev === undefined || !/^\d+$/.test(rev)) return undefined;
  return Number(rev);
}

/**
 * Save one section merged onto the newest stored copy, reading again and
 * merging again after each stale refusal. Resolves with what was stored;
 * rejects with the last stale refusal once every try was refused, and with
 * any other failure at once.
 */
export async function saveSectionMerged(
  save: VersionedSectionSave
): Promise<VersionedSectionSaved> {
  const refusals: StaleRefusal[] = [];
  const sent: (string | undefined)[] = [];
  // The conflicts the first try already met, before any refusal: a save
  // made before the author's read reached, not the one that refused it.
  let earlier: ReadonlySet<string> | undefined;
  return attemptUntilFresh(
    save.read,
    async latest => {
      const replaced = sectionOf(latest.doc, save.section);
      const { value, conflicts } = mergeSiteStyleSection(
        save.section,
        save.base,
        save.mine,
        replaced,
        save.prefer
      );
      earlier ??= new Set(conflicts.map(conflictIdentity));
      sent.push(latest.rev);
      const answered = await save.write(
        withVersionFrom({ [save.section]: value }, latest.rev)
      );
      return {
        stored: value,
        replaced,
        latest: answered,
        attempts: sent.length,
        ...(conflicts.length === 0
          ? {}
          : {
              conflicts: describeConflicts(conflicts, refusals, sent, earlier),
            }),
      };
    },
    {
      first: { read: save.latest },
      isStale: error => save.staleOf(error) !== undefined,
      onStale: error => {
        refusals.push(staleRefusalOf(save.staleOf(error)));
      },
    }
  );
}

/** A conflict's entry or setting, as one string. */
function conflictIdentity(conflict: EntryConflict): string {
  return `${conflict.setting ? "setting" : "entry"}:${conflict.key}`;
}

/**
 * The conflicts with what the refusals say of who caused them. The last
 * refusal's author is named, and exactly one save said to have come
 * between, only when it is the save that brought every conflict about: one
 * refusal sent the save back, the version it named is the one after the
 * version first sent, and the first try, made on the copy before that save,
 * met none of the conflicts. A conflict already there at the first try came
 * from a save made before, by whoever made it.
 */
function describeConflicts(
  entries: readonly EntryConflict[],
  refusals: readonly StaleRefusal[],
  sent: readonly (string | undefined)[],
  earlier: ReadonlySet<string> | undefined
): SaveConflicts {
  const last = refusals.at(-1);
  if (last === undefined) return { entries };
  const first = revisionNumber(sent[0]);
  const now = revisionNumber(last.currentVersion);
  const attributable =
    refusals.length === 1 &&
    first !== undefined &&
    now !== undefined &&
    now === first + 1 &&
    entries.every(entry => earlier?.has(conflictIdentity(entry)) !== true);
  return {
    entries,
    refusal: attributable
      ? {
          ...(last.changedBy === undefined
            ? {}
            : { changedBy: last.changedBy }),
          oneSaveBetween: true,
        }
      : { oneSaveBetween: false },
  };
}
