"use client";

/**
 * PublishAllLanguagesButton — the document rail's trigger for publishing every
 * language at once.
 *
 * Gating and the mutation live in `usePublishAllLanguages`, shared with the
 * header's Languages menu: one availability rule, two triggers. Renders
 * nothing when the action does not apply, so non-localized editors are
 * unchanged.
 *
 * @module components/features/entries/PublishAllLanguagesButton
 */

import { Button } from "@nextlyhq/ui";
import { Globe } from "lucide-react";

import { usePublishAllLanguages } from "./usePublishAllLanguages";

export interface PublishAllLanguagesButtonProps {
  /** Whether the collection has the Draft/Published lifecycle (per-language publish applies). */
  hasStatus?: boolean;
}

export function PublishAllLanguagesButton({
  hasStatus,
}: PublishAllLanguagesButtonProps) {
  const publish = usePublishAllLanguages(
    hasStatus === undefined ? {} : { hasStatus }
  );
  if (!publish.available) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={publish.pending}
      onClick={publish.publishAll}
    >
      <Globe className="h-3.5 w-3.5" />
      {publish.pending ? "Publishing…" : "Publish all languages"}
    </Button>
  );
}
