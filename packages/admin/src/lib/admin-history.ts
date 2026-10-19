/**
 * Whether the history entry behind the current one is an admin page, as far as
 * the admin itself saw it made.
 *
 * Browsers with the Navigation API can be asked about the previous entry
 * directly. Elsewhere only `document.referrer` says where a page came from,
 * and it keeps the value it had when the document loaded, so a move inside
 * the admin never reaches it. The router's history patch reports each move
 * here instead: the page a push LEAVES is the entry now behind.
 *
 * Kept as one value rather than a stack, because a back or forward jump lands
 * on an entry whose own predecessor this never saw. A jump therefore makes it
 * unknown again, and an unknown answer proves nothing to go back to.
 *
 * Imports nothing, so the router and the pages it draws can both reach it
 * without a cycle through the page registry.
 */

/** The admin's mount point, matched by whole segment. */
const ADMIN_ROOT = "/admin";

let behindIsAdmin: boolean | undefined;

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`);
}

/** A new entry was pushed while `pathname` was the current page. */
export function recordPushFrom(pathname: string): void {
  behindIsAdmin = isAdminPath(pathname);
}

/** The user moved through history, so what is behind is no longer known. */
export function forgetEntryBehind(): void {
  behindIsAdmin = undefined;
}

/** True or false where a push was seen since the last jump; else undefined. */
export function entryBehindIsAdmin(): boolean | undefined {
  return behindIsAdmin;
}
