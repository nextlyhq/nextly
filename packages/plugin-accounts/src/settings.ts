import { z } from "zod";

import { accountsError } from "./errors";

/**
 * The settings a site may change, each with its default and the bounds the
 * plugin keeps it within. A value outside its bounds refuses the plugin's
 * start rather than being clamped, so a site never runs on a number it did not
 * choose. The sign-in waits and the email-sending limits are the plugin's own
 * and are not settings at all.
 */

const HOUR = 1;
const DAY = 24 * HOUR;

const whole = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * A page of the site, as a path on its origin: one leading slash, never two
 * (which a browser reads as another host), and no query or fragment, since
 * the plugin adds the link's own.
 */
const sitePath = z
  .string()
  .regex(
    /^\/(?!\/)[^?#\s\\]*$/,
    "must be a path on the site, such as /account/verify"
  );

const DEFAULT_PAGES = {
  verify: "/account/verify",
  notMe: "/account/not-me",
  signIn: "/account/sign-in",
  reset: "/account/reset",
  confirmAddress: "/account/address",
  cancelAddressChange: "/account/address/cancel",
};

const accountsOptionsSchema = z
  .strictObject({
    /** The site's own origin, which every link in an email is built on. */
    origin: z.url({ protocol: /^https?$/ }),
    /**
     * The site's pages that links in emails land on, as paths on `origin`:
     * each shows what its link will do and asks the visitor to confirm.
     */
    pages: z
      .strictObject({
        /** Where a verification link lands. */
        verify: sitePath.default(DEFAULT_PAGES.verify),
        /** Where "this wasn't me" lands, to remove an account made with the address. */
        notMe: sitePath.default(DEFAULT_PAGES.notMe),
        /** Where a visitor signs in. */
        signIn: sitePath.default(DEFAULT_PAGES.signIn),
        /** Where a reset link lands. */
        reset: sitePath.default(DEFAULT_PAGES.reset),
        /** Where a new address's confirmation link lands, inside a signed-in session. */
        confirmAddress: sitePath.default(DEFAULT_PAGES.confirmAddress),
        /** Where the old address's link to cancel a change lands. */
        cancelAddressChange: sitePath.default(
          DEFAULT_PAGES.cancelAddressChange
        ),
      })
      .default(DEFAULT_PAGES),
    /** Whether an address must be verified before its account signs in. */
    verificationRequired: z.boolean().default(true),
    session: z
      .strictObject({
        /** Hours without use after which a session ends. */
        idleHours: whole(1, 365 * DAY).default(14 * DAY),
        /** Days after which a session ends, used or not. */
        absoluteDays: whole(1, 365).default(30),
        /** Sessions one account may hold at once; the oldest ends first. */
        perAccount: whole(5, 100).default(20),
      })
      .default({ idleHours: 14 * DAY, absoluteDays: 30, perAccount: 20 }),
    /** Days an account whose address nobody verified is kept. */
    unverifiedKeptDays: whole(1, 30).default(7),
    verification: z
      .strictObject({
        /** Hours a verification link stays good. */
        linkHours: whole(1, 24).default(24),
        /** Digits in a typed code. */
        codeDigits: whole(6, 8).default(6),
        /** Minutes a typed code stays good. */
        codeMinutes: whole(5, 10).default(10),
        /** Wrong codes allowed per address in any 24 hours. */
        codeTries: whole(3, 5).default(5),
      })
      .default({ linkHours: 24, codeDigits: 6, codeMinutes: 10, codeTries: 5 }),
    /** Minutes a password-reset link stays good. */
    resetLinkMinutes: whole(15, 60).default(60),
    /** Failed password checks in a row after which only a known browser, or a reset, gets in. */
    failuresBeforeReset: whole(10, 100).default(100),
    knownBrowsers: z
      .strictObject({
        /** Days a known browser stays known after it last signed in. */
        days: whole(7, 365).default(90),
        /** Known browsers one account keeps; the oldest is forgotten first. */
        perAccount: whole(1, 20).default(10),
      })
      .default({ days: 90, perAccount: 10 }),
    /** The shortest password accepted; every password up to 64 characters is used whole. */
    passwordMinLength: whole(8, 64).default(8),
    /** Whether new passwords are checked against known breached passwords. */
    breachedPasswordCheck: z.boolean().default(false),
    // No option of its own for a site that runs one instance: the plugin
    // reads core's `rateLimit.singleInstance`, through the limiter's store.
  })
  // A session's idle expiry cannot outlast its absolute lifetime.
  .refine(
    options => options.session.idleHours <= options.session.absoluteDays * DAY,
    {
      path: ["session", "idleHours"],
      message: "the idle expiry is longer than the absolute lifetime",
    }
  );

/**
 * The plugin's options as a site passes them.
 *
 * @experimental
 */
export type AccountsOptions = z.input<typeof accountsOptionsSchema>;

/**
 * The plugin's settings, every default filled in and every bound checked.
 *
 * @experimental
 */
export type AccountsSettings = z.output<typeof accountsOptionsSchema>;

/**
 * The settings a site's options resolve to, or a refusal naming each option
 * outside its bounds.
 *
 * @experimental
 * @throws `ACCOUNTS_INVALID_OPTIONS`
 */
export function resolveAccountsSettings(options: unknown): AccountsSettings {
  const parsed = accountsOptionsSchema.safeParse(options);
  if (!parsed.success) {
    throw accountsError("ACCOUNTS_INVALID_OPTIONS", {
      issues: parsed.error.issues.map(
        issue => `${issue.path.join(".")}: ${issue.message}`
      ),
    });
  }
  return parsed.data;
}
