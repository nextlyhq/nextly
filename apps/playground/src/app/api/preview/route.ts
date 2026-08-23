/**
 * The preview link's landing point.
 *
 * A preview link carries a signed token naming ONE entry, with an expiry and a
 * revocation generation. This route verifies it, starts a draft-reading session
 * scoped to that entry, and forwards to wherever the entry previews — all of
 * which `createPreviewRoute` already does, which is why there is nothing here
 * but the mount.
 *
 * The mount belongs to the application rather than the package because the
 * draft cookie is set by whichever ORIGIN serves the route, and only the site's
 * own origin is the right one. An admin deployed on a separate host would set
 * the cookie there and then send the reviewer to a site that never receives it,
 * where they would silently see the published page instead of the draft.
 *
 * Moving this file means telling the admin where it went: set
 * `preview: { route: "/your/path" }` in `nextly.config.ts`.
 */
import { createPreviewRoute } from "nextly/runtime";

export const { GET } = createPreviewRoute();
