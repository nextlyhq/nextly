"use client";

/**
 * The write that puts a selection in the pattern library.
 *
 * The counterpart to `pattern-library-client`, and the half that was missing:
 * the panel could read a library nothing could write to, so the tier shipped
 * empty and stayed empty.
 *
 * ## What travels, and what does not
 *
 * The DOCUMENT and the SELECTION, never a pattern this side built. What a saved
 * pattern is — which nodes travel, what is re-identified, which selections are
 * refused — is the planner's answer, and it depends on the block registry: this
 * browser holds the core blocks, while the server also holds every block another
 * plugin declared. A pattern planned here would answer nesting questions about
 * blocks it has never heard of.
 *
 * ## Why the library read is named as stale
 *
 * A save the author cannot then see is indistinguishable from one that failed.
 * The read is keyed by route, so naming it here is what refreshes the panel the
 * author opens next — and `invalidates` is scoped by construction to this
 * plugin's own paths.
 *
 * @module admin/save-pattern-client
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  apiErrorMessage,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback } from "react";

// The CONTRACT, not the route: the route reaches the collection through
// `nextly/config`, which is server-only and says so at load time.
import {
  LIBRARY_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
  SAVE_PATTERN_ROUTE_PATH,
  type SavePatternFields,
  type SavePatternRequest,
  type SavePatternResponse,
} from "../library-contract";

/** What a surface needs to save a selection and report how it went. */
export interface SavePatternWriter {
  /**
   * Store this selection, answering whether it was stored.
   *
   * A BOOLEAN rather than a message, because the message is not available at
   * this moment: `usePluginRouteMutation` records a failure in state, so it
   * reaches a caller on the next render rather than in the promise. Splitting
   * the two is what keeps the form from showing a stale reason next to a fresh
   * refusal — the answer says whether to close, {@link SavePatternWriter.error}
   * says what to show.
   */
  readonly save: (
    document: BlockDocument,
    selectedIds: readonly string[],
    fields: SavePatternFields
  ) => Promise<boolean>;
  /** Whether a save is in flight. */
  readonly saving: boolean;
  /**
   * Why the last save failed, phrased for an author, or `undefined`.
   *
   * Through the admin's own `apiErrorMessage`, so a refusal reads the way every
   * other failed write in this panel reads: the per-field reasons when the
   * server sent any, and the top-level message when it did not. A plugin
   * assembling its own would show "Validation failed." — true, and silent about
   * which field.
   */
  readonly error: string | undefined;
}

/**
 * The fallback for a failure that carried no message at all.
 *
 * A transport error rejects with a native `TypeError` and no payload, so there
 * is nothing to read. Said in the author's terms rather than the network's,
 * because "Failed to fetch" describes the program rather than what to do.
 */
const UNEXPLAINED = "The pattern could not be saved. Try again.";

/** Write to this plugin's save-as-pattern route. */
export function useSavePattern(): SavePatternWriter {
  const { write, pending, error } = usePluginRouteMutation<
    SavePatternRequest,
    SavePatternResponse
  >({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SAVE_PATTERN_ROUTE_PATH,
    // The panel's own read, so a pattern the author just saved is in the
    // library they open next.
    invalidates: [LIBRARY_ROUTE_PATH],
  });

  const save = useCallback(
    async (
      document: BlockDocument,
      selectedIds: readonly string[],
      fields: SavePatternFields
    ) => (await write({ document, selectedIds, fields })) !== undefined,
    [write]
  );

  return {
    save,
    saving: pending,
    error: error === null ? undefined : apiErrorMessage(error, UNEXPLAINED),
  };
}
