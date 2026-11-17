/**
 * Whether the request in hand is in Next's draft mode.
 *
 * A public content route answers an ordinary visit from the cache, so it asks
 * its draft gate only on a draft-mode request, which a preview link turns on
 * and Next renders on demand without storing it. Reading this flag keeps a
 * render static; reading the gate's cookie would not. Core's content route and
 * the page builder's (`@nextlyhq/blocks-react/next`) both ask it here.
 *
 * @module runtime/routing/draft-mode
 */

/**
 * True on a draft-mode request; false on any other, and outside a request,
 * where there is no draft mode to read. Next's own signals (a postponed
 * prerender, a dynamic bail-out) are handed back to it rather than read as no.
 *
 * Imported inside the call: `next/headers` resolves only within a request, so a
 * static import would make loading this module fail in every other context,
 * the CLI among them.
 */
export async function isDraftModeRequest(): Promise<boolean> {
  try {
    const { draftMode } = await import("next/headers");
    return (await draftMode()).isEnabled;
  } catch (error) {
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(error);
    return false;
  }
}
