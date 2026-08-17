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
  /**
   * Whether this collection previews at all, decided when the config synced.
   *
   * Written only by the code-first sync, because that is the path whose
   * declaration — a function — cannot itself be stored.
   */
  hasPreview?: boolean;
  /**
   * A UI-created collection's stored template.
   *
   * Read here ONLY to answer whether a preview exists. The URL is never built
   * from it in the browser: that is the resolver's job, and interpolating it
   * here would be the second implementation this design exists to avoid.
   */
  urlTemplate?: string;
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
  /**
   * Told when the preview OPENED but could not carry the editor's unsaved
   * edits, so it is showing the last saved version instead.
   *
   * Deliberately not folded into `onUnavailable`. That reports a click which
   * produced nothing; this reports one that produced something less than was
   * asked for. Merging them would either suppress a real warning or label a
   * working preview as a failure — and the editor's response differs: here
   * they can save and click again.
   */
  onUnsavedChangesNotSent?: () => void;
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
  /**
   * No usable site URL is configured, so no host can be named. Covers an absent
   * setting and one the browser would execute rather than navigate to.
   */
  | "noSiteUrl"
  /**
   * The browser refused the new tab. Distinct from every other reason because
   * nothing is wrong with the entry or the configuration — the editor can allow
   * popups and click again.
   */
  | "popupBlocked"
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
// Helpers
// ============================================================================

/**
 * Whether `url` is served from the origin this admin is running on.
 *
 * Decides only whether the session-storage handoff can work: that storage is
 * partitioned per origin, so a payload written here is unreachable from a
 * preview page served anywhere else. Compared by parsed origin rather than by
 * string prefix, which `https://site.example.com.evil.test` would satisfy.
 */
function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
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
  onUnsavedChangesNotSent,
}: UseEntryPreviewOptions): UseEntryPreviewResult {
  const previewConfig = collection.admin?.preview;

  // Answered from stored data, so the button does not flicker in after a fetch
  // and does not appear for a collection that has no preview at all.
  //
  // EITHER signal counts, because the two authoring paths store different
  // things: code-first syncs the boolean, since its function cannot be stored,
  // while a UI-created collection has its template stored directly and may
  // carry no boolean at all. Requiring the boolean alone would hide a preview
  // that a stored template plainly declares — and every row written before the
  // boolean existed is exactly that case.
  const isPreviewAvailable = useMemo(
    () =>
      previewConfig?.hasPreview === true || Boolean(previewConfig?.urlTemplate),
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

    // BEFORE the tab is opened, because a new browsing context receives a COPY
    // of session storage taken when it is created. A write afterwards stays in
    // this window, the new tab never sees the key, and the preview silently
    // renders the last saved values instead of what is on screen — the exact
    // failure the unsaved-data path exists to prevent.
    const previewKey = unsavedData
      ? storePreviewData(
          collection.name,
          entry?.id as string | undefined,
          dataToPreview
        )
      : undefined;

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

    // A blocked popup is NOT the same as a collection that asked to open in
    // place. Falling back to navigating this window would take the editor off
    // the form they are editing and discard everything unsaved, so it is
    // reported instead — the browser's own blocked-popup affordance is what lets
    // them retry.
    if (openInNewTab && !target) {
      onUnavailable?.("popupBlocked");
      return;
    }

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
      // The payload was written above; only the key is appended here.
      //
      // Session storage is partitioned by ORIGIN, and a resolved preview URL is
      // now routinely on a different one — that is what a configured site URL
      // means. The key would then name a payload the preview page cannot reach,
      // so it is omitted and the caller is told the preview shows saved content.
      // Appending it anyway would look like it worked and quietly show stale
      // data, which is the failure this whole path exists to prevent.
      const sameOrigin = isSameOrigin(resolution.url);
      const url =
        previewKey === undefined || !sameOrigin
          ? resolution.url
          : generatePreviewUrlWithData(resolution.url, previewKey);

      if (previewKey !== undefined && !sameOrigin) onUnsavedChangesNotSent?.();

      if (target) target.location.href = url;
      else window.location.href = url;
    } catch {
      abandon("failed");
    }
  }, [
    collection.name,
    entry,
    getFormValues,
    onUnavailable,
    onUnsavedChangesNotSent,
    previewConfig,
  ]);

  return {
    isPreviewAvailable,
    openPreview,
    label: previewConfig?.label || "Preview",
  };
}
