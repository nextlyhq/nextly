/**
 * Which pieces of admin furniture a mounted surface may ask to have removed.
 *
 * An immersive editor is not the only screen that will ever want the window to
 * itself — a media browser or a preview mode wants the same thing — so this is a
 * capability the admin owns rather than a special case for one route.
 */
export type AdminChromeLayer =
  | "primaryRail"
  | "subSidebar"
  | "documentSidebar"
  | "header";

/**
 * One surface's request, held for as long as that surface is mounted.
 *
 * `canExit` is the requester stating that it renders its own way back to the
 * admin. It decides whether the request is allowed to take the primary rail,
 * which is otherwise the only remaining route out — see `resolveSuppressedChrome`.
 */
export interface ChromeSuppressionRequest {
  layers: readonly AdminChromeLayer[];
  canExit: boolean;
}

/**
 * The layer that is only grantable to a requester that can be left.
 *
 * The rail is the whole of the admin's navigation. Removing it while the surface
 * offers no way back leaves an author with no route anywhere except the browser
 * URL, and the surfaces most likely to ask are exactly the ones holding unsaved
 * work. `header-visibility.ts` keeps the account dropdown for the same reason:
 * logout must stay reachable.
 */
const REQUIRES_EXIT: AdminChromeLayer = "primaryRail";

/**
 * Resolve what is hidden right now, union-merged across every mounted request.
 *
 * A layer is hidden if ANY request asks for it, so two immersive surfaces cannot
 * un-hide each other's chrome. The exception is `primaryRail`, granted per
 * REQUEST rather than per layer: a request without its own exit does not get it,
 * and cannot borrow the grant from a request that has one.
 *
 * Requests are keyed by mount rather than by route. A route list would be a
 * second answer to "is this surface immersive" living in the admin, and it would
 * drift every time a plugin added a route — silently, because a missing entry
 * renders correctly, just with chrome nobody wanted. The surface that IS
 * immersive is the one that knows, and it only says so while it exists.
 */
export function resolveSuppressedChrome(
  requests: Iterable<ChromeSuppressionRequest>
): Set<AdminChromeLayer> {
  const hidden = new Set<AdminChromeLayer>();
  for (const request of requests) {
    for (const layer of request.layers) {
      if (layer === REQUIRES_EXIT && !request.canExit) continue;
      hidden.add(layer);
    }
  }
  return hidden;
}
