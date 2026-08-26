/**
 * Whether a preview session reaches an embedded FRAME.
 *
 * The question has one correct answer and two places that need it: the route
 * that SETS the preview cookie, and the mint that tells the admin whether its
 * pane can show the site or must offer a new tab. Those two are in different
 * packages and different processes, so this module holds the policy and both
 * derive from it — an admin comparing URLs on its own would be a second
 * implementation of a question the cookie's own attributes already settle, and
 * the two would agree until someone changed the cookie.
 *
 * ## What this does NOT answer
 *
 * Only whether the SESSION survives framing. A frame can still fail to load for
 * reasons no server here can see — the site's own `frame-ancestors` policy, an
 * `X-Frame-Options` header from a proxy, a network refusal. Nextly does not set
 * those on the site's pages (`createSecurityHeadersMiddleware` is applied by the
 * API route handler, not to the application's own routes), but the application
 * may, and nothing in this process can observe it. A caller must therefore treat
 * a `true` here as "the session will reach it", never as "the frame will load".
 *
 * @module runtime/preview/preview-frame-policy
 */

/**
 * The `SameSite` attribute the preview cookie carries.
 *
 * Exported so the route's header and the reasoning below cannot drift apart.
 * The route builds its `Set-Cookie` from this rather than from a literal of its
 * own, because the answer this module gives is only correct for the policy the
 * cookie is ACTUALLY set with — two literals would agree on the day they were
 * written and diverge silently afterwards, and the failure would be a pane
 * confidently framing a site that then renders the published page.
 */
export const PREVIEW_COOKIE_SAME_SITE = "Lax" as const;

/**
 * Whether a browser showing the admin at `adminOrigin` will carry the preview
 * session into a frame pointed at `previewUrl`.
 *
 * `Lax` is withheld from a nested cross-site navigation — a frame is not a
 * top-level one — so for this cookie the question is exactly "is the frame
 * same-site with the admin".
 *
 * ## Why the test is narrower than same-site
 *
 * Same-site compares REGISTRABLE DOMAINS, so `admin.example.com` and
 * `example.com` are same-site and a correct answer for them is `true`. Deciding
 * that needs a public-suffix list: `foo.github.io` and `bar.github.io` share a
 * suffix and are NOT same-site, and no rule over the label structure alone can
 * tell the two shapes apart. This repository has no such list, so the test here
 * is the part that is decidable without one — an identical host is trivially the
 * same registrable domain.
 *
 * That is deliberately the conservative direction. Answering `true` wrongly puts
 * a frame on screen that renders the PUBLISHED page under a draft caption, which
 * is the silent wrong answer this whole gate exists to prevent; answering
 * `false` wrongly costs a new tab, which works everywhere. So the error this can
 * still make is the affordable one.
 *
 * Ports are ignored because same-site ignores them, which is why an admin on
 * `localhost:3000` may frame a site on `localhost:3100`. Schemes are compared
 * because browsers apply schemeful same-site.
 */
export function previewSessionReachesFrame(
  previewUrl: string | null,
  adminOrigin: string
): boolean {
  // No address means there is nothing to frame, which is a different reason
  // from a cross-site one but the same answer to this question.
  if (previewUrl === null) return false;

  let site: URL;
  let admin: URL;
  try {
    site = new URL(previewUrl);
    admin = new URL(adminOrigin);
  } catch {
    return false;
  }

  // Anything that is not http(s) has no cookie behaviour worth reasoning about
  // here, and two `file:` URLs would otherwise compare equal on an empty host.
  if (!/^https?:$/.test(site.protocol)) return false;

  if (site.protocol !== admin.protocol) return false;
  return site.hostname === admin.hostname;
}
