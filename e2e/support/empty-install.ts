/**
 * The production suite's second install: served from the same build as the
 * first, on a database with no account, so its setup route is still open.
 *
 * Shared by the config that starts it and the spec that drives it, so the two
 * cannot name different ports or tokens.
 *
 * @module support/empty-install
 */

/** Where the empty install is served. */
export const EMPTY_INSTALL_PORT = Number(process.env.E2E_SETUP_PORT) || 3102;

/** Its database, relative to the playground, as `DATABASE_URL` takes it. */
export const EMPTY_INSTALL_DB_RELATIVE = "file:./data/e2e-setup.db";

/**
 * The operator's setup token the empty install runs with, through
 * `NEXTLY_SETUP_TOKEN`. A literal, for the reason the suite's secret is one;
 * long and varied enough to pass the strength rule a production install
 * applies to an operator's token.
 */
export const EMPTY_INSTALL_SETUP_TOKEN =
  "e2e-setup-token-Qx7Vb2Lm9Rt4Wz8Np3Hk6Jd1Fs5Gc0Ya";
