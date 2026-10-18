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
  | {
      kind: "origin";
      pageOrigin: string;
      appOrigin: string;
      /**
       * Absent on a page whose address carries a query, such as a reset or
       * invitation token: the query is not sent elsewhere, and the page is
       * unusable without it, so the person reopens the link they were sent.
       */
      href?: string;
    }
  /**
   * The two addresses are not two names for this machine: a server behind a
   * proxy or in a container reports the address it listens on, which the
   * person's browser may not reach at all. So this names the setting instead,
   * and offers no link.
   */
  | { kind: "unlisted"; pageOrigin: string; appOrigin: string }
  /** Refused for a reason the form has nothing more to say about. */
  | { kind: "refused"; message: string };

/**
 * The refusal a caught submission error stands for, or null when it was not a
 * refusal (403) at all, or is one of the codes the form `explains` itself (the
 * sign-in form's unverified email, which it answers with a resend action), so
 * the form's own handling applies.
 */
export function authRefusalOf(
  error: unknown,
  page: PagePlace,
  explains: readonly string[] = []
): AuthRefusal | null {
  if (!isApiError(error) || error.status !== 403) return null;
  if (error.code !== undefined && explains.includes(error.code)) return null;

  const reason = error.code === "CSRF_FAILED" ? error.data?.reason : undefined;
  if (reason === "origin") {
    const refusal = originRefusal(error.data?.appOrigin, page);
    if (refusal) return refusal;
  }
  if (reason === "token") {
    return {
      kind: "refused",
      message:
        "This form could not be verified, usually because the page has been open a long time. Reload the page and try again.",
    };
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
 * What a refused origin tells the person, or null when the server named no
 * usable address of its own. Only an address that differs from where the page
 * is helps: the same one would send the person back to the refused page.
 */
function originRefusal(reported: unknown, page: PagePlace): AuthRefusal | null {
  const appOrigin = webOrigin(reported);
  if (appOrigin === undefined || appOrigin === page.origin) return null;
  // A link is offered only between two names for this machine, the one case
  // where the other address is known to reach the same server.
  if (!isLoopback(appOrigin) || !isLoopback(page.origin)) {
    return { kind: "unlisted", pageOrigin: page.origin, appOrigin };
  }
  // The query can hold a secret (a password-reset or invitation token), and
  // it is never sent to another address; without it such a page cannot work,
  // so no link is offered for it.
  return page.search === ""
    ? {
        kind: "origin",
        pageOrigin: page.origin,
        appOrigin,
        href: `${appOrigin}${page.pathname}`,
      }
    : { kind: "origin", pageOrigin: page.origin, appOrigin };
}

/** Whether an origin names this machine: `localhost`, a `*.localhost`, or a loopback IP. */
function isLoopback(origin: string): boolean {
  const host = new URL(origin).hostname;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
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
