"use client";

/**
 * Minting a shareable preview link and putting it on the clipboard.
 *
 * @module hooks/usePreviewLink
 */

import { useMutation } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { previewLinkApi } from "@admin/services/previewLinkApi";

/**
 * Where `createPreviewRoute` is mounted, by convention.
 *
 * The route handler is written to be dropped into `app/api/preview/route.ts`,
 * which is where a Next application puts a route handler, and the admin has no
 * other way to learn the path: the mount point is a file in the user's own app,
 * invisible from here.
 *
 * A convention with an override is the honest arrangement. Guessing silently
 * would produce a copied link that 404s with nothing to explain it; demanding
 * configuration before the feature works at all would make the common case pay
 * for the uncommon one.
 */
export const DEFAULT_PREVIEW_ROUTE = "/api/preview";

export interface UsePreviewLinkOptions {
  collection: string;
  entryId: string;
  /** Restricts the link to one locale. Absent means every locale. */
  locale?: string;
  /**
   * The site the link points at. Without one the link is relative, which is
   * correct when the admin and the site share an origin and useless when they
   * do not.
   */
  siteUrl?: string;
  /** Overrides {@link DEFAULT_PREVIEW_ROUTE} for an app that mounted it elsewhere. */
  previewRoute?: string;
}

/** Assemble the URL a reviewer will open. */
export function buildPreviewUrl({
  token,
  siteUrl,
  previewRoute = DEFAULT_PREVIEW_ROUTE,
}: {
  token: string;
  siteUrl?: string;
  previewRoute?: string;
}): string {
  // `encodeURIComponent` rather than raw interpolation: a token is base64url
  // and safe today, but a query value assembled by hand is exactly where an
  // encoding assumption stops being true later.
  const query = `?token=${encodeURIComponent(token)}`;
  if (!siteUrl) return `${previewRoute}${query}`;
  // Trailing slashes on a configured site URL are common and would otherwise
  // produce `https://site.com//api/preview`.
  return `${siteUrl.replace(/\/+$/, "")}${previewRoute}${query}`;
}

/**
 * Copy text to the clipboard, reporting whether it worked.
 *
 * The Clipboard API is unavailable on an insecure origin and can be refused by
 * permission policy, and both surface as a rejection rather than a return
 * value. Reporting the failure lets the caller show the link instead of
 * claiming a copy that never happened.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mint a preview link for one entry and put it on the clipboard.
 *
 * Minting happens per click rather than once per entry, deliberately: a link
 * carries an expiry, so a value cached in the page would be handed out after it
 * had stopped working.
 */
export function usePreviewLink({
  collection,
  entryId,
  locale,
  siteUrl,
  previewRoute,
}: UsePreviewLinkOptions) {
  return useMutation({
    mutationFn: async (): Promise<{ url: string; copied: boolean }> => {
      const link = await previewLinkApi.mint({
        collection,
        entryId,
        ...(locale === undefined ? {} : { locale }),
      });
      const url = buildPreviewUrl({
        token: link.token,
        ...(siteUrl === undefined ? {} : { siteUrl }),
        ...(previewRoute === undefined ? {} : { previewRoute }),
      });
      return { url, copied: await copyToClipboard(url) };
    },
    onSuccess: ({ url, copied }) => {
      if (copied) {
        toast.success("Preview link copied.");
        return;
      }
      // Not a failure of the mint: the link exists and works. Showing it is the
      // only way the editor can still use it when the browser refused the copy.
      //
      // It has to STAY on screen to be usable. A preview URL is a few hundred
      // characters of signed token, and the default toast dismisses itself in
      // about four seconds, which is not long enough to select one by hand and
      // leaves nothing behind when it goes. So this one persists until the
      // editor closes it, and offers the copy again as an action.
      //
      // The action re-copies the URL already minted rather than minting a new
      // one. Every mint issues another live bearer credential, so a retry that
      // went back to the server would leave a trail of working links behind
      // each failed copy.
      const shown = toast.info(
        "Preview link ready, but your browser blocked the copy.",
        {
          description: url,
          duration: Infinity,
          closeButton: true,
          action: {
            label: "Copy",
            onClick: event => {
              // Clicking an action closes the toast unless the event is
              // prevented, and the retry only settles afterwards. Left alone,
              // a retry that fails again would take the one copy of the link
              // off screen and replace it with an error — the editor would be
              // further from the link than before they clicked.
              event.preventDefault();
              void copyToClipboard(url).then(retried => {
                if (!retried) {
                  toast.error("Your browser is still blocking the copy.");
                  return;
                }
                toast.success("Preview link copied.");
                // Dismissed only now, when the clipboard actually holds it.
                toast.dismiss(shown);
              });
            },
          },
        }
      );
    },
    onError: () => {
      toast.error("Couldn't create a preview link.");
    },
  });
}
