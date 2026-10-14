import {
  cancelAddressChange,
  confirmAddressChangeByCode,
  confirmAddressChangeByLink,
  requestAddressChange,
} from "../flows/address-change";
import { changePassword } from "../flows/change-password";
import { deleteOwnAccount } from "../flows/delete-account";
import { DAY, type FlowDeps } from "../flows/deps";
import { removeUnverifiedAccount } from "../flows/not-me";
import { resendVerification } from "../flows/resend";
import { completePasswordReset } from "../flows/reset";
import { requestPasswordReset } from "../flows/reset-request";
import { sessionAccount, signOut, signOutEverywhere } from "../flows/sessions";
import { signIn } from "../flows/sign-in";
import { signUp } from "../flows/sign-up";
import {
  verifyByCode,
  verifyByCodeWithPassword,
  verifyByLink,
  verifyByLinkWithPassword,
} from "../flows/verify";
import { refuse, unlessRefused } from "../http/answers";
import {
  cookieClear,
  cookieName,
  cookieWrite,
  knownTokensOf,
  readCookie,
  withKnownToken,
} from "../http/cookies";
import { assertSameOrigin, safeReturnPath } from "../http/guard";

import type {
  AccountCookie,
  AccountCookieChange,
  AccountOutcome,
  AccountsServer,
  AccountVisitor,
  VerifyAddressInput,
} from "./contract";

/**
 * The sentence each server function answers with, the same whichever way a
 * site reaches it: a REST answer's `message`, or a server action's state.
 */
export const ACCOUNT_MESSAGES = {
  signUp: "Check your email to confirm your address.",
  verifyAddress: "Your address is confirmed.",
  resendVerification:
    "If that address needs confirming, we've sent the email again.",
  removeUnverifiedAccount: "The account was removed.",
  signIn: "Signed in.",
  signOut: "Signed out.",
  signOutEverywhere: "Signed out everywhere.",
  requestPasswordReset:
    "If that address has an account, we've sent a link to reset its password.",
  resetPassword: "Your password is changed. Sign in with it.",
  changePassword: "Your password is changed.",
  changeAddress: "Check the new address's email to confirm it.",
  confirmAddressChange: "Your email address is changed.",
  cancelAddressChange: "The change of address is cancelled.",
  deleteAccount: "Your account is deleted.",
} as const;

/**
 * The plugin's typed server functions over the flows. `deps` is read on
 * every call, so the functions always reach the started plugin.
 */
export function accountsService(deps: () => FlowDeps): AccountsServer {
  return {
    async signUp({ visitor, name, address, password }) {
      const result = unlessRefused(
        await signUp(deps(), {
          name,
          address,
          password,
          client: visitor.client,
          ...browserOf(visitor),
        })
      );

      return outcome("signUp", [
        set("signUp", result.browserToken, result.browserTokenExpiresAt),
      ]);
    },

    async verifyAddress(input) {
      const result = unlessRefused(await verify(deps(), input));
      if (result.status === "sign-in-needed") signInNeeded();
      const cookies: AccountCookieChange[] = [clear("signUp")];
      if (result.session !== null)
        cookies.push(
          set("session", result.session.token, result.session.expiresAt)
        );

      return {
        ...outcome("verifyAddress", cookies),
        signedIn: result.session !== null,
      };
    },

    async resendVerification({ visitor, address }) {
      unlessRefused(
        await resendVerification(deps(), { address, ...attemptOf(visitor) })
      );

      return outcome("resendVerification");
    },

    async removeUnverifiedAccount({ token }) {
      unlessRefused(await removeUnverifiedAccount(deps(), { token }));

      return outcome("removeUnverifiedAccount");
    },

    async signIn({ visitor, address, password }) {
      const flow = deps();
      const result = unlessRefused(
        await signIn(flow, { address, password, ...attemptOf(visitor) })
      );

      return outcome("signIn", [
        set("session", result.session.token, result.session.expiresAt),
        knownBrowser(flow, visitor, result.knownBrowserToken),
      ]);
    },

    async signOut({ visitor }) {
      if (visitor.sessionToken !== null && visitor.sessionToken !== "")
        await signOut(deps(), { sessionToken: visitor.sessionToken });

      return outcome("signOut", [clear("session")]);
    },

    async signOutEverywhere({ visitor }) {
      if (!(await signOutEverywhere(deps(), sessionOf(visitor))))
        signInNeeded();

      return outcome("signOutEverywhere", [clear("session")]);
    },

    async requestPasswordReset({ visitor, address }) {
      unlessRefused(
        await requestPasswordReset(deps(), { address, ...attemptOf(visitor) })
      );

      return outcome("requestPasswordReset");
    },

    async resetPassword({ visitor, token, password }) {
      const flow = deps();
      const result = unlessRefused(
        await completePasswordReset(flow, {
          token,
          password,
          knownTokens: visitor.knownTokens,
        })
      );

      return outcome("resetPassword", [
        knownBrowser(flow, visitor, result.knownBrowserToken),
      ]);
    },

    async changePassword({ visitor, currentPassword, newPassword }) {
      signedIn(
        await changePassword(deps(), {
          ...sessionOf(visitor),
          ...attemptOf(visitor),
          currentPassword,
          newPassword,
        })
      );

      return outcome("changePassword");
    },

    async changeAddress({ visitor, currentPassword, newAddress }) {
      signedIn(
        await requestAddressChange(deps(), {
          ...sessionOf(visitor),
          ...attemptOf(visitor),
          currentPassword,
          newAddress,
        })
      );

      return outcome("changeAddress");
    },

    async confirmAddressChange(input) {
      const flow = deps();
      const session = sessionOf(input.visitor);
      const result =
        "token" in input
          ? await confirmAddressChangeByLink(flow, {
              ...session,
              token: input.token,
            })
          : await confirmAddressChangeByCode(flow, {
              ...session,
              code: input.code,
            });
      if (result.status === "sign-in-needed") signInNeeded();
      unlessRefused(result);

      return outcome("confirmAddressChange");
    },

    async cancelAddressChange({ token }) {
      unlessRefused(await cancelAddressChange(deps(), { token }));

      return outcome("cancelAddressChange");
    },

    async deleteAccount({ visitor, currentPassword }) {
      signedIn(
        await deleteOwnAccount(deps(), {
          ...sessionOf(visitor),
          ...attemptOf(visitor),
          currentPassword,
        })
      );

      return outcome("deleteAccount", [clear("session")]);
    },

    async currentAccount({ visitor }) {
      if (visitor.sessionToken === null) return null;

      return sessionAccount(deps(), { sessionToken: visitor.sessionToken });
    },

    visitorFrom(from) {
      const { settings, core } = deps();
      // Headers alone are read as a request to the site's own origin: only
      // its headers are ever read.
      const request =
        from instanceof Request
          ? from
          : new Request(settings.origin, { headers: new Headers(from) });

      return {
        client: core.limits.clientKey(request),
        sessionToken:
          readCookie(request, cookieName(settings, "session")) ?? null,
        knownTokens: knownTokensOf(settings, request),
        signUpToken:
          readCookie(request, cookieName(settings, "signUp")) ?? null,
      };
    },

    checkOrigin(headers) {
      assertSameOrigin(headers, deps().settings);
    },

    returnPath(next, fallback = "/") {
      return safeReturnPath(deps().settings, next, fallback);
    },

    signInPath(returnTo) {
      const { settings } = deps();
      const back = safeReturnPath(settings, returnTo, "");

      return back === ""
        ? settings.pages.signIn
        : `${settings.pages.signIn}?${new URLSearchParams({ next: back }).toString()}`;
    },

    cookieWrite(change) {
      const { settings, now } = deps();

      return change.action === "set"
        ? cookieWrite(
            settings,
            change.cookie,
            change.value,
            change.expiresAt,
            now()
          )
        : cookieClear(settings, change.cookie);
    },
  };
}

/** Verifies by link or by code, with the password where one is given. */
function verify(deps: FlowDeps, input: VerifyAddressInput) {
  const { visitor } = input;
  const password = input.password ?? "";
  if ("token" in input) {
    return password !== ""
      ? verifyByLinkWithPassword(deps, {
          token: input.token,
          password,
          ...attemptOf(visitor),
        })
      : verifyByLink(deps, { token: input.token, ...browserOf(visitor) });
  }

  const typed = { address: input.address, code: input.code };
  return password !== ""
    ? verifyByCodeWithPassword(deps, {
        ...typed,
        password,
        ...attemptOf(visitor),
      })
    : verifyByCode(deps, { ...typed, ...browserOf(visitor) });
}

/** What a password attempt or an email request is counted on: the client and the browser's known tokens. */
function attemptOf(visitor: AccountVisitor) {
  return { client: visitor.client, knownTokens: visitor.knownTokens };
}

/** The sign-up cookie's token, where the browser holds one. */
function browserOf(visitor: AccountVisitor): { browserToken?: string } {
  return visitor.signUpToken === null
    ? {}
    : { browserToken: visitor.signUpToken };
}

/** The session token, or the empty string every flow refuses as signed out. */
function sessionOf(visitor: AccountVisitor): { sessionToken: string } {
  return { sessionToken: visitor.sessionToken ?? "" };
}

/** A holder's action answered, refusing one whose session has ended as needing a sign-in. */
function signedIn(result: { status: string }): void {
  if (result.status === "signed-out") signInNeeded();
  unlessRefused(result);
}

function signInNeeded(): never {
  refuse({ status: "refused", reason: "sign-in-needed" });
}

/** The known-browser cookie with `token` added as the newest. */
function knownBrowser(
  deps: FlowDeps,
  visitor: AccountVisitor,
  token: string
): AccountCookieChange {
  return set(
    "knownBrowsers",
    withKnownToken(visitor.knownTokens, token),
    new Date(deps.now().getTime() + deps.settings.knownBrowsers.days * DAY)
  );
}

function outcome(
  action: keyof typeof ACCOUNT_MESSAGES,
  cookies: readonly AccountCookieChange[] = []
): AccountOutcome {
  return { message: ACCOUNT_MESSAGES[action], cookies };
}

function set(
  cookie: AccountCookie,
  value: string,
  expiresAt: Date
): AccountCookieChange {
  return { cookie, action: "set", value, expiresAt };
}

function clear(cookie: AccountCookie): AccountCookieChange {
  return { cookie, action: "clear" };
}
