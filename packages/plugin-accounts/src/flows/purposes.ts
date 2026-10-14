/**
 * The purposes the plugin's one-purpose secrets are minted for. Core
 * prefixes each with the plugin's name, and a secret is spent only for the
 * purpose it was minted for.
 */
export const PURPOSES = {
  /** The link in a verification email. */
  verifyLink: "verify-link",
  /** The code to type from a verification email. */
  verifyCode: "verify-code",
  /** "This wasn't me": removes an unverified account made with the address. */
  notMe: "not-me",
  /** Ties a sign-up to the browser that made it, so only it is signed in by verifying. */
  signUpBrowser: "sign-up-browser",
  /** The link in a reset email. */
  reset: "reset",
  /** The link to a new address that confirms a change to it. */
  addressChangeLink: "address-change-link",
  /** The code to type from that email. */
  addressChangeCode: "address-change-code",
  /** The old address's link that cancels the change. */
  addressChangeCancel: "address-change-cancel",
} as const;
