/**
 * An author's unsaved work recorded in one language, forgotten when that
 * language's pending change is discarded.
 *
 * The editor offers to restore unsaved changes from the author's recovery
 * point, one per document and author, which carries the language it was
 * recorded in. Discarding a language's pending change throws that language's
 * work away, so its recovery point goes with it; one recorded in another
 * language is the author's work there and stays.
 *
 * @module domains/i18n/forget-recovery-point
 */

import {
  VersionsRepository,
  type VersionRef,
} from "../versions/versions-repository";
import { workingDraftLocale } from "../versions/working-draft-locale";

/** The connection a discard runs on, as the versions repository takes it. */
type VersionsConnection = ConstructorParameters<typeof VersionsRepository>[0];

export async function forgetRecoveryPointIn(
  tx: VersionsConnection,
  args: {
    ref: VersionRef;
    /** Who discarded; no author, no recovery point of theirs to forget. */
    author: string | undefined;
    /** The slot the discarded pending change was kept under. */
    slot: string | null;
    documentLocalized: boolean;
    defaultLocale: string | null;
  }
): Promise<void> {
  if (args.author === undefined) return;
  const repo = new VersionsRepository(tx);
  const point = await repo.findAutosave(args.ref, args.author);
  if (!point) return;
  // The point's language read as a pending change's slot is, so the default
  // language recorded as no language matches a discard of the default.
  const recordedIn = workingDraftLocale({
    documentLocalized: args.documentLocalized,
    requestLocale: point.locale ?? null,
    defaultLocale: args.defaultLocale,
  });
  if (recordedIn !== args.slot) return;
  await repo.deleteAutosaves(args.ref, args.author);
}
