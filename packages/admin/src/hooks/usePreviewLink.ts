"use client";

/**
 * Minting a shareable preview link and putting it on the clipboard.
 *
 * @module hooks/usePreviewLink
 */

import { useMutation } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import {
  previewLinkApi,
  type PreviewLinkRequest,
} from "@admin/services/previewLinkApi";

/**
 * What to mint a link for: one collection entry, or one Single.
 *
 * The union is the endpoint's own, restated here so the two cannot drift into
 * accepting different shapes.
 */
export type UsePreviewLinkOptions = PreviewLinkRequest;

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
export function usePreviewLink(target: UsePreviewLinkOptions) {
  return useMutation({
    mutationFn: async (): Promise<{ url: string; copied: boolean }> => {
      // Passed through as the union it arrived as. Destructuring and rebuilding
      // it here would be a second place that decides which fields a mint
      // request carries, and the two would drift the moment one gains a field.
      const link = await previewLinkApi.mint(target);

      // The server answers `null` only when it can find the site's address
      // NOWHERE — neither the Site URL setting nor the application's own
      // `NEXT_PUBLIC_APP_URL` — and that is not something to paper over. A
      // relative URL here would be resolved against the ADMIN's origin, which is
      // not the site's on any deployment that separates them, and a link to the
      // wrong host is worse than no link because it looks like it worked.
      //
      // Both remedies are named because either one settles it, and they belong
      // to different people: an administrator can fill in the setting without a
      // deploy, while the environment variable is a developer's to set.
      // `== null` catches an absent field as well as an explicit null. The
      // contract says `string | null`, but a response that simply omits it —
      // an older server, a proxy that reshapes JSON — must not reach the
      // clipboard as the string "undefined".
      if (link.url == null) {
        throw new Error(
          "This site has no address configured, so a preview link has nowhere " +
            "to point. An administrator can set the Site URL in Settings, or a " +
            "developer can set NEXT_PUBLIC_APP_URL."
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
      // The thrown message rather than a fixed one: it names what is missing and
      // who can supply it, and collapsing it into "couldn't create a preview
      // link" hides the only remedies there are.
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't create a preview link."
      );
    },
  });
}
