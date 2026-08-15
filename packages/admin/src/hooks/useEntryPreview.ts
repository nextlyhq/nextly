"use client";

/**
 * Opening an entry's preview.
 *
 * The URL is resolved by the server rather than here: a code-first collection
 * declares its preview as a function that no column can hold, and the site URL
 * the answer is based on sits behind a `settings` permission that editors and
 * authors do not hold. So this hook decides WHETHER to offer the button, from a
 * boolean the registry can store, and asks the server WHERE only when it is
 * clicked.
 *
 * @module hooks/useEntryPreview
 */

import { useCallback, useMemo } from "react";

import {
  storePreviewData,
  generatePreviewUrlWithData,
} from "@admin/lib/preview/preview-data";
import { previewUrlApi } from "@admin/services/previewUrlApi";

// ============================================================================
// Types
// ============================================================================

/**
 * The preview settings the admin reads back from the collection registry.
 *
 * Deliberately not the authored declaration: `url` is a function and
 * `urlTemplate` is the server's resolution input, so neither belongs here.
 * What the panel needs is whether to draw a button and how to label it.
 */
export interface PreviewConfig {
  /** Whether this collection previews at all, decided when the config synced. */
  hasPreview?: boolean;
  /** Whether to open the preview in a new tab. @default true */
  openInNewTab?: boolean;
  /** Custom label for the preview button. @default "Preview" */
  label?: string;
}

/** Collection configuration required for preview functionality. */
export interface PreviewCollection {
  /** Collection slug. */
  name: string;
  admin?: {
    preview?: PreviewConfig;
  };
}

export interface UseEntryPreviewOptions {
  collection: PreviewCollection;
  /** The saved entry, when editing an existing one. */
  entry?: Record<string, unknown> | null;
  /** Current form values, so the preview reflects unsaved edits. */
  getFormValues?: () => Record<string, unknown>;
  /** Told why a click could not open anything. */
  onUnavailable?: (reason: PreviewUnavailableReason) => void;
}

/**
 * Why a preview click produced nothing.
 *
 * Separate from the button's availability because these are only discoverable
 * on click: the entry's own values decide two of them, and the third is a
 * deployment setting the panel cannot see.
 */
export type PreviewUnavailableReason =
  /** Declared, but not for this entry yet — no slug, wrong status. */
  | "unavailable"
  /** No site URL is configured, so no host can be named. */
  | "noSiteUrl"
  /** The request itself failed. */
  | "failed";

export interface UseEntryPreviewResult {
  /** Whether to offer the button at all. Known without a round trip. */
  isPreviewAvailable: boolean;
  /** Resolve and open. Asynchronous: the URL comes from the server. */
  openPreview: () => Promise<void>;
  /** Label for the preview button. */
  label: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * useEntryPreview - open the site at the entry being edited.
 *
 * @example
 * ```tsx
 * const { isPreviewAvailable, openPreview, label } = useEntryPreview({
 *   collection,
 *   entry,
 *   getFormValues: () => form.getValues(),
 *   onUnavailable: reason => toast.error(PREVIEW_MESSAGES[reason]),
 * });
 * ```
 */
export function useEntryPreview({
  collection,
  entry,
  getFormValues,
  onUnavailable,
}: UseEntryPreviewOptions): UseEntryPreviewResult {
  const previewConfig = collection.admin?.preview;

  // From the stored boolean, so the button does not flicker in after a fetch
  // and does not appear for a collection that has no preview at all.
  const isPreviewAvailable = useMemo(
    () => previewConfig?.hasPreview === true,
    [previewConfig]
  );

  const openPreview = useCallback(async () => {
    const unsavedData = getFormValues?.();
    const dataToPreview = unsavedData ? { ...entry, ...unsavedData } : entry;
    if (!dataToPreview) {
      onUnavailable?.("unavailable");
      return;
    }

    const openInNewTab = previewConfig?.openInNewTab !== false;

    // Opened NOW, synchronously, while the click is still on the stack. A window
    // opened after an `await` has lost the user-gesture context and Safari and
    // Firefox block it, so the tab is claimed first and navigated once the URL
    // arrives.
    //
    // `noopener` cannot be passed here: with it, `window.open` returns null and
    // there is no handle left to navigate. The reference is severed by hand
    // instead, while the tab is still `about:blank` and same-origin — after
    // which it cannot reach back through `window.opener`.
    const target = openInNewTab ? window.open("", "_blank") : null;
    if (target) target.opener = null;

    const abandon = (reason: PreviewUnavailableReason) => {
      target?.close();
      onUnavailable?.(reason);
    };

    try {
      const resolution = await previewUrlApi.resolve({
        collection: collection.name,
        entry: dataToPreview,
      });

      if (resolution.status !== "resolved") {
        // `notConfigured` is not reported: the button should not have been
        // offered, so telling the editor a preview is unavailable would describe
        // a state they cannot act on. The other two are theirs to fix — fill in
        // the slug, or ask an admin to set the site URL.
        if (resolution.status !== "notConfigured") abandon(resolution.status);
        else target?.close();
        return;
      }

      // Unsaved values travel through session storage rather than the URL, so
      // the preview renders what is on screen instead of what was last saved.
      const url = unsavedData
        ? generatePreviewUrlWithData(
            resolution.url,
            storePreviewData(
              collection.name,
              entry?.id as string | undefined,
              dataToPreview
            )
          )
        : resolution.url;

      if (target) target.location.href = url;
      else window.location.href = url;
    } catch {
      abandon("failed");
    }
  }, [collection.name, entry, getFormValues, onUnavailable, previewConfig]);

  return {
    isPreviewAvailable,
    openPreview,
    label: previewConfig?.label || "Preview",
  };
}
