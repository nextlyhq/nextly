/**
 * Sentinel `challengeId` for the forced first-sign-in password change. A user
 * whose account still holds an admin-set password is issued a pending token
 * carrying this id instead of a session; `handleSetInitialPassword` accepts
 * only tokens marked with it.
 *
 * Its own module, importing nothing: the plugin resolver reserves the id, and
 * the token module it belongs with loads the library that signs tokens.
 */
export const MUST_CHANGE_PASSWORD_CHALLENGE = "must-change-password";
