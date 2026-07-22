/**
 * PublishAllLanguagesButton — publish every language of an entry at once (i18n M7, spec §10).
 *
 * The spec's default publish behavior for localized+draft collections: one click publishes all
 * languages together (per-language publish stays available via the normal locale-scoped Save/Publish).
 * Atomic on the server. Renders nothing unless localization is on, the collection is localized and
 * has drafts, and the entry exists — so non-localized editors are unchanged.
 *
 * @module components/features/entries/PublishAllLanguagesButton
 */

import { Button } from "@nextlyhq/ui";
import { Globe } from "lucide-react";

import { usePublishAllLocales } from "@admin/hooks/queries/usePublishAllLocales";
import { useCan } from "@admin/hooks/useCan";
import { useLocalization } from "@admin/hooks/useLocalization";

import { useEntryLocale } from "./EntryLocaleContext";

export interface PublishAllLanguagesButtonProps {
  /** Whether the collection has the Draft/Published lifecycle (per-language publish applies). */
  hasStatus?: boolean;
}

export function PublishAllLanguagesButton({
  hasStatus,
}: PublishAllLanguagesButtonProps) {
  const { enabled, locales } = useLocalization();
  const { collectionLocalized, collectionSlug, entryId } = useEntryLocale();
  const publishAll = usePublishAllLocales({
    collectionSlug: collectionSlug ?? "",
  });
  // Publishing every language is a publish, so it owes the same permission the
  // header Publish button does. Without this an author holding only
  // `update-<slug>` could publish all languages from the sidebar, bypassing the
  // header gate. Empty slug matches no permission, keeping the hook unconditional.
  const canPublish = useCan(`publish-${collectionSlug ?? ""}`);

  if (
    !enabled ||
    !hasStatus ||
    !collectionLocalized ||
    !collectionSlug ||
    !entryId ||
    locales.length < 2 ||
    !canPublish
  ) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={publishAll.isPending}
      onClick={() => publishAll.mutate(entryId)}
    >
      <Globe className="h-3.5 w-3.5" />
      {publishAll.isPending ? "Publishing…" : "Publish all languages"}
    </Button>
  );
}
