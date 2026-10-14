import type { SignedInAccount } from "../flows/sessions";
import type { CookieKind, CookieWrite } from "../http/cookies";

/**
 * A visitor as the server functions see them: the limiter's key for their
 * network address, and the plugin's cookies their browser holds. Read it
 * from a request with `visitorFrom`; nothing in it is ever trusted beyond
 * finding what it names.
 *
 * @experimental
 */
export interface AccountVisitor {
  /** The limiter's key for the visitor's network address, or null where core cannot read one. */
  readonly client: string | null;
  /** The session cookie's token, or null. */
  readonly sessionToken: string | null;
  /** The known-browser cookie's tokens, at most ten. */
  readonly knownTokens: readonly string[];
  /** The sign-up cookie's token, or null. */
  readonly signUpToken: string | null;
}

/**
 * The cookies a server function may set or clear. The CSRF cookie is not
 * among them: only the REST endpoints use it.
 *
 * @experimental
 */
export type AccountCookie = Exclude<CookieKind, "csrf">;

/**
 * One cookie the caller sets or clears after a server function, which never
 * writes a cookie itself. `cookieWrite` turns it into a name, a value and
 * the attributes a cookie store takes.
 *
 * @experimental
 */
export type AccountCookieChange =
  | {
      readonly cookie: AccountCookie;
      readonly action: "set";
      readonly value: string;
      readonly expiresAt: Date;
    }
  | { readonly cookie: AccountCookie; readonly action: "clear" };

/**
 * What every server function that changes something answers: a sentence a
 * page may show, and the cookies to set or clear, in order. A refusal is
 * thrown instead, as a `NextlyError` with one of the plugin's stable codes.
 *
 * @experimental
 */
export interface AccountOutcome {
  readonly message: string;
  readonly cookies: readonly AccountCookieChange[];
}

/** The visitor a server function acts for. */
interface ForVisitor {
  readonly visitor: AccountVisitor;
}

/** A link's token from an email, spent by the function it is handed to. */
interface WithToken {
  readonly token: string;
}

/**
 * Verifies an address by its link's token, or by the address and its typed
 * code. With `password`, in a browser other than the one that signed up.
 *
 * @experimental
 */
export type VerifyAddressInput = ForVisitor & {
  readonly password?: string;
} & (WithToken | { readonly address: string; readonly code: string });

/**
 * Confirms an address change by its link's token, or by its typed code,
 * inside the session that asked for it.
 *
 * @experimental
 */
export type ConfirmAddressChangeInput = ForVisitor &
  (WithToken | { readonly code: string });

/**
 * The plugin's typed server functions: every action a visitor takes on
 * their account, the same ones the REST endpoints offer. Each takes the
 * visitor's cookies as input and answers the cookies to change, so the
 * caller owns reading and writing them; none checks where a request came
 * from, so a caller acting on a browser's request checks its origin first
 * (`checkOrigin`).
 *
 * @experimental
 */
export interface AccountsServer {
  /** Signs up. A taken address is answered exactly as a free one. */
  signUp(
    input: ForVisitor & {
      readonly name: string;
      readonly address: string;
      readonly password: string;
    }
  ): Promise<AccountOutcome>;
  /** Verifies an address; `signedIn` says whether it started a session. */
  verifyAddress(
    input: VerifyAddressInput
  ): Promise<AccountOutcome & { readonly signedIn: boolean }>;
  /** Sends the verification email again, if the address needs it. */
  resendVerification(
    input: ForVisitor & { readonly address: string }
  ): Promise<AccountOutcome>;
  /** "This wasn't me": removes an unverified account made with the address. */
  removeUnverifiedAccount(input: WithToken): Promise<AccountOutcome>;
  /** Signs in, setting the session and known-browser cookies. */
  signIn(
    input: ForVisitor & { readonly address: string; readonly password: string }
  ): Promise<AccountOutcome>;
  /** Ends this session alone. Signed out already is not a refusal. */
  signOut(input: ForVisitor): Promise<AccountOutcome>;
  /** Ends every session of the account. */
  signOutEverywhere(input: ForVisitor): Promise<AccountOutcome>;
  /** Sends a reset link, if the address has an account. */
  requestPasswordReset(
    input: ForVisitor & { readonly address: string }
  ): Promise<AccountOutcome>;
  /** Sets a new password from a reset link; nobody is signed in by it. */
  resetPassword(
    input: ForVisitor & WithToken & { readonly password: string }
  ): Promise<AccountOutcome>;
  /** Changes the signed-in account's password, given the current one. */
  changePassword(
    input: ForVisitor & {
      readonly currentPassword: string;
      readonly newPassword: string;
    }
  ): Promise<AccountOutcome>;
  /** Asks to change the signed-in account's address, given its password. */
  changeAddress(
    input: ForVisitor & {
      readonly currentPassword: string;
      readonly newAddress: string;
    }
  ): Promise<AccountOutcome>;
  /** Confirms an address change, inside the session that asked for it. */
  confirmAddressChange(
    input: ConfirmAddressChangeInput
  ): Promise<AccountOutcome>;
  /** Cancels an address change, from the old address's link. */
  cancelAddressChange(input: WithToken): Promise<AccountOutcome>;
  /** Deletes the signed-in account, given its password. */
  deleteAccount(
    input: ForVisitor & { readonly currentPassword: string }
  ): Promise<AccountOutcome>;
  /** The signed-in account, or null. */
  currentAccount(input: ForVisitor): Promise<SignedInAccount | null>;

  /**
   * The visitor a request carries: its network key and the plugin's
   * cookies. Takes the request's headers alone where there is no request,
   * as in a server component or a server action.
   */
  visitorFrom(request: Request | Headers): AccountVisitor;
  /**
   * Refuses a request whose `Origin` (or, without one, its `Referer`) is not
   * the site's configured origin.
   *
   * @throws `ACCOUNTS_CROSS_SITE`
   */
  checkOrigin(headers: Headers): void;
  /**
   * Where to send a visitor next: `next` when it is a path on the site's
   * own origin, else `fallback`.
   */
  returnPath(next: string | undefined, fallback?: string): string;
  /** The site's sign-in page, with `returnTo` to come back to when it is a path on the site. */
  signInPath(returnTo?: string): string;
  /** How to write a cookie change: its name, value and attributes. */
  cookieWrite(change: AccountCookieChange): CookieWrite;
}
