/**
 * The site's absolute address, for a preview link that has to name a host.
 *
 * A link travels by email and chat, so it cannot be relative: the recipient has
 * no admin session and no origin to resolve one against. The address itself is
 * a fact about the deployment rather than about the entry being shared, which
 * is why it is resolved once here instead of at each of the four places a link
 * or a preview URL is assembled.
 *
 * **Two sources, in this order, and the order is the whole design.** The stored
 * Site URL setting wins because it is the only value that can name a site on a
 * DIFFERENT origin from the admin — the split deployment it exists for. Absent,
 * the application's own `NEXT_PUBLIC_APP_URL` answers, which is correct for the
 * ordinary case where the admin is mounted inside the site's own Next.js app,
 * and is already required in production by the environment schema.
 *
 * Refusing when the setting is unset was the previous behaviour and it made the
 * feature unreachable on a new installation: nothing prompts an operator to
 * fill that setting in, so "Copy shareable link" answered "ask an
 * administrator" on every fresh install, including one where the admin and the
 * site are plainly the same origin. This is the chain media URLs and email
 * links already resolve through, so the answer is one the codebase already
 * gives rather than a second opinion about where this site lives.
 *
 * @module domains/preview/site-url
 */

import { env } from "../../lib/env";
import { asNavigableUrl } from "../collections/services/preview-url-resolver";

/**
 * The first source that names somewhere a browser may actually navigate.
 *
 * Both are checked rather than just the fallback. The setting's own API refuses
 * a non-http(s) scheme, but that check is newer than the column, so a row
 * written before it can still hold `javascript:alert(1)` — and the environment
 * schema validates its value with `z.string().url()`, which accepts any scheme
 * the WHATWG parser does. A link built from either is copied to a clipboard and
 * pasted into an address bar.
 *
 * `null` when neither answers, which callers report rather than paper over: a
 * link to nowhere is worse than no link, because it looks like it worked.
 */
export function resolvePreviewSiteUrl(
  configured: string | null
): string | null {
  for (const candidate of [configured, env.NEXT_PUBLIC_APP_URL]) {
    if (candidate === null || candidate === undefined) continue;
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    // The parsed form, not the input: it normalises the origin, and returning
    // the raw string would let two spellings of one address reach the two
    // callers that join a path onto it.
    const parsed = asNavigableUrl(trimmed);
    if (parsed !== null) return parsed.toString();
  }
  return null;
}
