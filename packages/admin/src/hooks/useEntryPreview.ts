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
 * What opens is the site's own draft route, so it shows the last SAVED draft.
 * The editor's unsaved edits do not travel with it and no parameter claims they
 * do: the page renders on the server, and the only way browser-held values
 * could reach it is for the site to render what the browser sent — which is
 * content that never passed the field-level read rules the draft route applies.
 *
 * @module hooks/useEntryPreview
 */

import { useCallback, useMemo } from "react";

import {
  previewUrlApi,
  type PreviewUrlResolution,
} from "@admin/services/previewUrlApi";

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
  /**
   * The SAVED entry, which is also what the preview will render.
   *
   * Deliberately not the on-screen form values. The preview opens the site's
   * own draft route, so what it renders is the last saved draft — and resolving
   * the URL from an unsaved slug would name a page that does not exist yet,
   * turning a working preview into a 404 the editor cannot explain. Resolving
   * from the saved row means the address and the content agree.
   */
  entry?: Record<string, unknown> | null;
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

/**
 * What to tell the editor for each reason a preview click produced nothing.
 *
 * Lives beside the reason type rather than at a call site so the set stays
 * exhaustive: `Record` over the union means adding a reason without a message
 * fails to compile, which is the only way a caller learns a new case exists.
 * Each names what the reader can do about it, because a reason they cannot act
 * on reads as the admin being broken.
 */
export const PREVIEW_MESSAGES: Record<PreviewUnavailableReason, string> = {
  unavailable:
    "This entry cannot be previewed yet. Check that it has a slug and a status the site publishes.",
  noSiteUrl:
    "No site URL is configured, so there is nowhere to open. An administrator can set it in Settings.",
  popupBlocked:
    "Your browser blocked the preview tab. Allow pop-ups for this site and try again.",
  failed: "Could not work out where this entry previews. Please try again.",
};

/**
 * What the server's answer means for the tab that has already been claimed.
 *
 * Separated from the sequence around it because it is the only part that is a
 * DECISION rather than choreography: opening the tab early, severing its
 * opener and closing it again are all forced by how browsers treat a click,
 * while this is a four-case mapping that can be read on its own. Keeping it
 * pure also means the mapping is exercised without a window, a user gesture or
 * a round trip.
 */
type PreviewOutcome =
  | { kind: "open"; url: string }
  | { kind: "report"; reason: PreviewUnavailableReason }
  /** Nothing to open and nothing to say — close the claimed tab quietly. */
  | { kind: "close" };

/**
 * Claims the browsing context the preview will land in.
 *
 * Its own function because everything here is forced by how browsers treat a
 * click rather than by anything this feature decides, and all of it must
 * happen before the first `await`:
 *
 * - A window opened after an `await` has lost the user-gesture context, and
 *   Safari and Firefox block it. So the tab is claimed first and navigated
 *   once the URL arrives.
 * - `noopener` cannot be passed: with it `window.open` returns null and there
 *   is no handle left to navigate. The reference is severed by hand instead,
 *   while the tab is still `about:blank` and same-origin — after which it
 *   cannot reach back through `window.opener`.
 *
 * `"blocked"` is distinct from a null target, which is what opening in PLACE
 * looks like. Falling back to navigating this window would take the editor off
 * the form they are editing and discard everything unsaved, so the two cannot
 * share a representation.
 */
function claimTab(
  openInNewTab: boolean
): { target: Window | null } | "blocked" {
  if (!openInNewTab) return { target: null };
  const target = window.open("", "_blank");
  if (!target) return "blocked";
  target.opener = null;
  return { target };
}

function outcomeOf(resolution: PreviewUrlResolution): PreviewOutcome {
  if (resolution.status === "resolved") {
    return { kind: "open", url: resolution.url };
  }
  // `notConfigured` is deliberately silent: the button should not have been
  // offered at all, so telling the editor a preview is unavailable describes a
  // state they cannot act on. The other two ARE theirs to act on — fill in the
  // slug, or ask an administrator to set the site URL.
  if (resolution.status === "notConfigured") return { kind: "close" };
  return { kind: "report", reason: resolution.status };
}

/**
 * Applies an outcome to the context claimed for it.
 *
 * The counterpart to {@link claimTab}: every path that does not navigate has
 * to close what was claimed, because a blank tab left open reads as a preview
 * that failed to load rather than as one that was never going to open.
 *
 * The URL is navigated to UNCHANGED. Nothing is appended to carry the editor's
 * unsaved edits: the preview renders the site's own draft route on the server,
 * so the only content it can show is what has been saved. A parameter
 * promising otherwise would have to be read by the site, and reading
 * browser-supplied field values there would render content that never passed
 * the field-level read rules the draft route applies.
 */
function settle(
  target: Window | null,
  outcome: PreviewOutcome,
  onUnavailable?: (reason: PreviewUnavailableReason) => void
): void {
  if (outcome.kind === "open") {
    // A null target is opening in PLACE, which `claimTab` has already
    // distinguished from a blocked popup.
    if (target) target.location.href = outcome.url;
    else window.location.href = outcome.url;
    return;
  }
  target?.close();
  if (outcome.kind === "report") onUnavailable?.(outcome.reason);
}

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
 *   onUnavailable: reason => toast.error(PREVIEW_MESSAGES[reason]),
 * });
 * ```
 */
export function useEntryPreview({
  collection,
  entry,
  onUnavailable,
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

  /*
   * Three steps, each its own question: may this open at all, what context
   * does it open in, and what did the server say to do with it.
   */
  const openPreview = useCallback(async () => {
    if (!entry) {
      onUnavailable?.("unavailable");
      return;
    }

    // Claimed before anything is awaited; see `claimTab`.
    const claimed = claimTab(previewConfig?.openInNewTab !== false);
    if (claimed === "blocked") {
      onUnavailable?.("popupBlocked");
      return;
    }

    try {
      const resolution = await previewUrlApi.resolve({
        collection: collection.name,
        entry,
      });
      settle(claimed.target, outcomeOf(resolution), onUnavailable);
    } catch {
      // A failed request is reported like any other refusal, so the claimed tab
      // is closed on this path too rather than left blank.
      settle(
        claimed.target,
        { kind: "report", reason: "failed" },
        onUnavailable
      );
    }
  }, [collection.name, entry, onUnavailable, previewConfig]);

  return {
    isPreviewAvailable,
    openPreview,
    label: previewConfig?.label || "Preview",
  };
}
