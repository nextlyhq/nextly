"use client";

/**
 * Minting a shareable preview link and putting it on the clipboard.
 *
 * @module hooks/usePreviewLink
 */

import { useMutation } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { previewLinkApi } from "@admin/services/previewLinkApi";

export interface UsePreviewLinkOptions {
  collection: string;
  entryId: string;
  /** Restricts the link to one locale. Absent means every locale. */
  locale?: string;
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
}: UsePreviewLinkOptions) {
  return useMutation({
    mutationFn: async (): Promise<{ url: string; copied: boolean }> => {
      const link = await previewLinkApi.mint({
        collection,
        entryId,
        ...(locale === undefined ? {} : { locale }),
      });

      // The server answers `null` when no site URL is configured, and that is
      // not something to paper over. A relative URL here would be resolved
      // against the ADMIN's origin, which is not the site's on any deployment
      // that separates them — and a link to the wrong host is worse than no
      // link, because it looks like it worked.
      // `== null` catches an absent field as well as an explicit null. The
      // contract says `string | null`, but a response that simply omits it —
      // an older server, a proxy that reshapes JSON — must not reach the
      // clipboard as the string "undefined".
      if (link.url == null) {
        throw new Error(
          "No site URL is configured, so a preview link has nowhere to point. " +
            "An administrator can set one in Settings."
        );
      }

      return { url: link.url, copied: await copyToClipboard(link.url) };
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
    onError: (error: unknown) => {
      // The thrown message rather than a fixed one: "no site URL is configured"
      // names something an administrator can act on, and collapsing it into
      // "couldn't create a preview link" hides the only remedy there is.
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't create a preview link."
      );
    },
  });
}
