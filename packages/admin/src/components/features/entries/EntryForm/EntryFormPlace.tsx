"use client";

/**
 * The entry form's place, as both editors draw it: the form's own fields are
 * the `fields` built-in, and plugins' blocks stand around them in the order
 * the server sent, each told which document the form edits, and handed the
 * document as loaded.
 *
 * One component for both editors, so a collection entry's form and a Single's
 * cannot come to disagree about what a block is told.
 *
 * @module components/entries/EntryForm/EntryFormPlace
 */
import type React from "react";

import { TargetSlot } from "@admin/components/shared/target-slot";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";

export interface EntryFormPlaceProps {
  /** Which kind of document the form edits. */
  kind: "collection" | "single";
  /** The collection's or the Single's slug. */
  slug: string;
  /** The document's id, or `null` while it is being created. */
  entryId: string | null;
  /** The document as loaded, handed to each block. */
  entry?: Record<string, unknown>;
  /** The form's own fields. */
  children: React.ReactNode;
}

export function EntryFormPlace({
  kind,
  slug,
  entryId,
  entry,
  children,
}: EntryFormPlaceProps): React.ReactNode {
  const { user } = useDashboardUser();
  return (
    <TargetSlot
      place="entry.form"
      // Held while the viewer is not known yet, so no block is handed an id
      // that is not theirs.
      context={user ? { userId: user.id, kind, slug, entryId } : null}
      {...(entry === undefined ? {} : { entry })}
      builtIns={{ fields: children }}
    />
  );
}
