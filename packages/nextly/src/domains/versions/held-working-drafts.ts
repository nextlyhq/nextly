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
/**
 * The configured languages other than `writeDraftLocale` among those holding a
 * working draft of one document (`draftLocales`, as stored: `null` is the
 * unlocalized slot).
 *
 * Pure, so the write asks it of the drafts it reads under its row lock and a
 * release's readiness asks it of drafts read for a whole batch of documents at
 * once: the reads differ, the rule does not.
 *
 * Only a language the app still configures can block the write. A draft left
 * behind by a language that was REMOVED would otherwise refuse every
 * document-wide publish and takedown forever, and the remedy the refusal
 * recommends — publish or discard it — cannot be carried out, because reads
 * and writes reject that locale. The stale draft is left where it is: a write
 * asked to move a lifecycle has no business deleting somebody's stored work.
 */
export function languagesHoldingWorkingDrafts(args: {
  draftLocales: Iterable<string | null>;
  /** The slot the write's own working draft is stored under. */
  writeDraftLocale: string | null;
  configuredLocales: readonly string[];
}): string[] {
  const configured = new Set(args.configuredLocales);
  return [...args.draftLocales].filter(
    (locale): locale is string =>
      locale !== null &&
      locale !== args.writeDraftLocale &&
      configured.has(locale)
  );
}
