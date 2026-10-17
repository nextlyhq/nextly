/**
 * Which other languages hold unreleased work that a document-wide lifecycle
 * write must not decide the fate of.
 *
 * A write that moves every language at once (`locale: "*"`) would publish, or
 * take down, a language while that language's pending edit stayed unreleased,
 * marking a translation live against values its author had already replaced.
 * Releasing those edits in the same write is not the smaller problem it looks:
 * a pending edit stores the whole document as it looked when it was saved, so
 * two languages' edits cannot be merged without inventing a rule for which
 * shared value wins. So such a write is refused while any other language holds
 * one, and the person is told which.
 *
 * One rule for the collection and the Single write paths, which ask it under
 * their row lock, and for a release's readiness, which asks it ahead of the
 * release's run so the refusal is learned while it can still be acted on.
 *
 * @module domains/versions/held-working-drafts
 */
import type { VersionRef, VersionsRepository } from "./versions-repository";

/**
 * The configured languages other than `writeDraftLocale` that hold a working
 * draft of this document; empty when the document keeps no drafts.
 *
 * Only a language the app still configures can block the write. A draft left
 * behind by a language that was REMOVED would otherwise refuse every
 * document-wide publish and takedown forever, and the remedy the refusal
 * recommends — publish or discard it — cannot be carried out, because reads
 * and writes reject that locale. The stale draft is left where it is: a write
 * asked to move a lifecycle has no business deleting somebody's stored work.
 */
export async function languagesHoldingWorkingDrafts(args: {
  versions: Pick<VersionsRepository, "findAllWorkingDrafts">;
  ref: VersionRef;
  /** Whether the collection or Single keeps working drafts at all. */
  draftsEnabled: boolean;
  /** The slot the write's own working draft is stored under. */
  writeDraftLocale: string | null;
  configuredLocales: readonly string[];
}): Promise<string[]> {
  if (!args.draftsEnabled) return [];
  const configured = new Set(args.configuredLocales);
  return (await args.versions.findAllWorkingDrafts(args.ref))
    .map(draft => draft.locale)
    .filter(
      (locale): locale is string =>
        locale !== null &&
        locale !== args.writeDraftLocale &&
        configured.has(locale)
    );
}
