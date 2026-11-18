"use client";

/**
 * What the editor has open, as the shared-style usage read names it: the
 * saved document, the blocks field the editor is bound to, the language and
 * the stored form. The route reports that field's saved share of each
 * style's blocks apart, so the open page is counted from its live copy.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/usage-here
 */
import {
  useDocumentActions,
  useDocumentIdentity,
  useDocumentLocale,
  useDocumentStatus,
} from "@nextlyhq/plugin-sdk/admin";
import { createContext, useContext, type Context } from "react";

import type { SharedStyleUsageHere } from "../../library-contract";

/** The blocks field the editor is bound to, provided around the editor. */
export const UsageHereField: Context<string | undefined> = createContext<
  string | undefined
>(undefined);

/**
 * What the editor has open, or `undefined` outside an editor or before the
 * document is saved once, when no saved count holds it yet. The form is the
 * pending working draft where the document has one, since that is what the
 * editor opens and saves; else the main row, which stays live as saved while
 * it is published (`keepsSaved`).
 */
export function useUsageHere(): SharedStyleUsageHere | undefined {
  const identity = useDocumentIdentity();
  const locale = useDocumentLocale()?.code ?? undefined;
  const status = useDocumentStatus();
  const drafting = status?.hasWorkingDraft === true;
  // Published with no pending draft: the page stays live as saved until this
  // edit is published, so its saved blocks still count.
  const keepsSaved = !drafting && status?.status === "published";
  const field = useContext(UsageHereField);
  if (identity === null || field === undefined) return undefined;
  const document =
    identity.kind === "single"
      ? { single: identity.slug }
      : identity.documentId === undefined
        ? undefined
        : { collection: identity.slug, id: identity.documentId };
  if (document === undefined) return undefined;
  return {
    document,
    field,
    ...(locale === undefined ? {} : { locale }),
    variant: drafting ? "draft" : "published",
    ...(keepsSaved ? { keepsSaved: true as const } : {}),
  };
}

/**
 * What a usage read naming the open document is held by: what is open, and
 * when the document was last stored. A save can change the open document's
 * saved parts while nothing else about what is open changes (a published
 * page saved again where the collection keeps no drafts), so a read made
 * before it would go on counting blocks the save removed.
 */
export function useUsageReadKey(
  here: SharedStyleUsageHere | undefined
): string {
  const storedAt = useDocumentActions()?.storedAt ?? null;
  return JSON.stringify([here ?? null, storedAt?.getTime() ?? null]);
}
