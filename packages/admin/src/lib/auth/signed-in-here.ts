/**
 * Whether someone has signed in to this admin from this browser before.
 *
 * The admin page is prebuilt, the same for every visitor, and the session
 * cookie is hidden from scripts on purpose, so before the server answers the
 * page cannot tell a returning editor from a stranger. This flag is the one
 * thing it may go on to choose the FIRST screen: the admin's frame for a
 * browser that has signed in here, the sign-in form for one that has not.
 *
 * It grants nothing. Every screen behind it still waits for the server to
 * confirm the session before it draws any data, and a wrong flag costs only
 * one screen that gives way once the server answers. It is set when the
 * server confirms a session and removed on sign-out and whenever the server
 * says there is none.
 *
 * Storage can be unavailable (a private window, blocked site data), so every
 * read and write is guarded: unreadable reads as "not signed in here", which
 * shows the sign-in form, the screen that is right for anyone.
 *
 * @module lib/auth/signed-in-here
 */

/** Where the flag is kept, under the admin's own storage prefix. */
export const SIGNED_IN_HERE_KEY = "nextly:admin:signed-in-here";

/** Whether this browser has a record of a sign-in to this admin. */
export function hasSignedInHere(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_HERE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Records that the server confirmed a session in this browser. */
export function rememberSignedInHere(): void {
  try {
    window.localStorage.setItem(SIGNED_IN_HERE_KEY, "1");
  } catch {
    // Storage refused: the next visit shows the sign-in form first, which
    // still leads to the same admin.
  }
}

/** Forgets the record, on sign-out or when the server says there is no session. */
export function forgetSignedInHere(): void {
  try {
    window.localStorage.removeItem(SIGNED_IN_HERE_KEY);
  } catch {
    // Storage refused: nothing was kept to forget.
  }
}
