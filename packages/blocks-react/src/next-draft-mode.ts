/**
 * Whether the request in hand is in Next's draft mode.
 *
 * The public content route answers an ordinary visit from the cache, so it
 * asks its draft gate only on a draft-mode request, which the preview link
 * turns on and Next renders on demand without storing it. Reading this flag
 * keeps a render static; reading the gate's cookie would not.
 *
 * @module next-draft-mode
 */

/**
 * True on a draft-mode request; false on any other, and outside a request,
 * where there is no draft mode to read. Next's own signals (a postponed
 * prerender, a dynamic bail-out) are handed back to it rather than read as no.
 *
 * Imported inside the call, as this subpath imports `next/navigation`, so
 * loading the module never needs a request in scope.
 */
export async function inDraftMode(): Promise<boolean> {
  try {
    const { draftMode } = await import("next/headers");
    return (await draftMode()).isEnabled;
  } catch (error) {
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(error);
    return false;
  }
}
