/**
 * What a signed-out form shows when the server refused its submission.
 *
 * A refusal used to reach these forms as a toast at most, and "Invalid request
 * origin" in a corner told nobody that the page was simply open at the wrong
 * address. The two refusals the auth routes answer with need different things
 * from the person: an address the app accepts, or a fresh page. So the answer
 * is read here, once, and every auth form shows it the same way.
 */

import { isApiError } from "@admin/lib/api/parseApiError";

/** Where the page is, as `window.location` gives it. */
export interface PagePlace {
  origin: string;
  pathname: string;
  search: string;
}

export type AuthRefusal =
  /**
   * The origin check refused the address the page is open at. `href` is the
   * same page at the app's own address.
   */
  | { kind: "origin"; pageOrigin: string; appOrigin: string; href: string }
  /** Refused for a reason the form has nothing more to say about. */
  | { kind: "refused"; message: string };

/**
 * The refusal a caught submission error stands for, or null when it was not a
 * refusal (403) at all, so the form's own handling applies.
 */
export function authRefusalOf(
  error: unknown,
  page: PagePlace
): AuthRefusal | null {
  if (!isApiError(error) || error.status !== 403) return null;

  if (error.code === "CSRF_FAILED") {
    if (error.data?.reason === "origin") {
      const appOrigin = webOrigin(error.data.appOrigin);
      // Only an address that differs from where the page is helps: the same
      // one would send the person back to the page that was just refused.
      if (appOrigin !== undefined && appOrigin !== page.origin) {
        return {
          kind: "origin",
          pageOrigin: page.origin,
          appOrigin,
          href: `${appOrigin}${page.pathname}${page.search}`,
        };
      }
    }
    if (error.data?.reason === "token") {
      return {
        kind: "refused",
        message:
          "This form could not be verified, usually because the page has been open a long time. Reload the page and try again.",
      };
    }
  }

  return {
    kind: "refused",
    message:
      error.message.trim() !== ""
        ? error.message
        : "The server refused this request.",
  };
}

/**
 * The value as an http(s) origin, or undefined. It becomes a link, so only a
 * value that is exactly an origin, and on the web, is used.
 */
function webOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin === value ? value : undefined;
  } catch {
    return undefined;
  }
}
