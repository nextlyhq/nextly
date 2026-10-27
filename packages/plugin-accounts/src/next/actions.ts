import { NextlyError } from "@nextlyhq/plugin-sdk";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { AccountsServer } from "../server/contract";
import {
  callWithFields,
  type AccountAction,
  type FieldOutcome,
} from "../server/fields";
import { accountsServer } from "../server/installed";

/**
 * What an account action answers its form, for React's `useActionState`:
 * nothing yet; done, with a sentence to show; or refused, with the plugin's
 * stable code, its public message and what a page may branch on (`reason`,
 * `retryAfterSeconds`, `triesLeft`).
 *
 * @experimental
 */
export type AccountFormState =
  | { readonly status: "idle" }
  | {
      readonly status: "done";
      readonly message: string;
      /** Whether the action signed the visitor in: a verification can. */
      readonly signedIn: boolean;
    }
  | {
      readonly status: "refused";
      readonly code: string;
      readonly message: string;
      readonly data: Readonly<Record<string, unknown>>;
    };

/**
 * A form's state before its first submission.
 *
 * @experimental
 */
export const initialAccountFormState: AccountFormState = { status: "idle" };

/**
 * An account action, shaped for `useActionState(action, initialState)` and
 * so for a form that posts before JavaScript loads. A server component's
 * plain `<form action>` binds the state first:
 * `action={signOutAction.bind(null, initialAccountFormState)}`.
 *
 * @experimental
 */
export type AccountFormAction = (
  previous: AccountFormState,
  form: FormData
) => Promise<AccountFormState>;

/**
 * Where an action sends the visitor once it has succeeded: always (to the
 * form's `next`, or home), or only when the form names a `next`. Either way
 * only to a path on the site's own origin.
 */
type After = "always" | "when-asked";

/**
 * An action: the request's origin checked, the visitor read from its
 * cookies, the action's server function called with the form's fields,
 * the cookies it answers written, and then the visitor sent on.
 */
function accountAction(
  action: AccountAction,
  after: After = "when-asked"
): AccountFormAction {
  return async (_previous, form) => {
    const server = await accountsServer();
    const state = await settle(server, action, form);
    if (state.status !== "done") return state;

    const next = text(form, "next") || undefined;
    const target =
      after === "always"
        ? server.returnPath(next)
        : server.returnPath(next, "");
    // Outside any try: a redirect is thrown, and Next.js answers it with a
    // 303, which a browser without JavaScript follows.
    if (target !== "") redirect(target);

    return state;
  };
}

/** The action run to its state; a refusal a visitor should see becomes one, anything else is thrown. */
async function settle(
  server: AccountsServer,
  action: AccountAction,
  form: FormData
): Promise<AccountFormState> {
  try {
    const requestHeaders = await headers();
    // Next.js checks a server action's origin against the host it was sent
    // to; this checks it against the site's configured origin, as the REST
    // endpoints do, before any flow runs.
    server.checkOrigin(requestHeaders);
    const outcome = await callWithFields(
      action,
      server,
      server.visitorFrom(requestHeaders),
      name => text(form, name)
    );
    await writeCookies(server, outcome);

    return {
      status: "done",
      message: outcome.message,
      signedIn: outcome.signedIn === true,
    };
  } catch (error) {
    if (!shownToVisitor(error)) throw error;

    return {
      status: "refused",
      code: error.code,
      message: error.publicMessage,
      data: error.publicData ?? {},
    };
  }
}

/** Writes the cookie changes an action answered, each with the plugin's own attributes. */
async function writeCookies(
  server: AccountsServer,
  outcome: FieldOutcome
): Promise<void> {
  const jar = await cookies();
  for (const change of outcome.cookies) {
    const { name, value, options } = server.cookieWrite(change);
    jar.set(name, value, { ...options });
  }
}

/**
 * A refusal the visitor caused or can wait out: the plugin's own codes
 * below 500, and "try again". A fault of the site's (a plugin that has not
 * started, say) is thrown, so it reaches the site's logs and error page
 * rather than a form.
 */
function shownToVisitor(error: unknown): error is NextlyError {
  return (
    NextlyError.is(error) &&
    (error.statusCode < 500 || error.code === "ACCOUNTS_TRY_AGAIN")
  );
}

/** A form field as text; absent, or a file, reads as the empty string. */
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Signs up (`name`, `address`, `password`).
 *
 * @experimental
 */
export const signUpAction: AccountFormAction = accountAction("signUp");

/**
 * Verifies an address by a link's `token`, or by `address` and `code`; with
 * `password` in a browser other than the one that signed up.
 *
 * @experimental
 */
export const verifyAddressAction: AccountFormAction =
  accountAction("verifyAddress");

/**
 * Sends the verification email again (`address`).
 *
 * @experimental
 */
export const resendVerificationAction: AccountFormAction =
  accountAction("resendVerification");

/**
 * "This wasn't me": removes an unverified account (a link's `token`).
 *
 * @experimental
 */
export const removeUnverifiedAccountAction: AccountFormAction = accountAction(
  "removeUnverifiedAccount"
);

/**
 * Signs in (`address`, `password`), then sends the visitor to `next` when
 * it is a path on the site, else home.
 *
 * @experimental
 */
export const signInAction: AccountFormAction = accountAction(
  "signIn",
  "always"
);

/**
 * Signs this browser out.
 *
 * @experimental
 */
export const signOutAction: AccountFormAction = accountAction("signOut");

/**
 * Signs the account out everywhere.
 *
 * @experimental
 */
export const signOutEverywhereAction: AccountFormAction =
  accountAction("signOutEverywhere");

/**
 * Sends a reset link (`address`).
 *
 * @experimental
 */
export const requestPasswordResetAction: AccountFormAction = accountAction(
  "requestPasswordReset"
);

/**
 * Sets a new password from a reset link (`token`, `password`).
 *
 * @experimental
 */
export const resetPasswordAction: AccountFormAction =
  accountAction("resetPassword");

/**
 * Changes the password (`currentPassword`, `newPassword`).
 *
 * @experimental
 */
export const changePasswordAction: AccountFormAction =
  accountAction("changePassword");

/**
 * Asks to change the address (`currentPassword`, `newAddress`).
 *
 * @experimental
 */
export const changeAddressAction: AccountFormAction =
  accountAction("changeAddress");

/**
 * Confirms an address change by a link's `token`, or by `code`, inside the
 * session that asked.
 *
 * @experimental
 */
export const confirmAddressChangeAction: AccountFormAction = accountAction(
  "confirmAddressChange"
);

/**
 * Cancels an address change (the old address's link's `token`).
 *
 * @experimental
 */
export const cancelAddressChangeAction: AccountFormAction = accountAction(
  "cancelAddressChange"
);

/**
 * Deletes the account (`currentPassword`).
 *
 * @experimental
 */
export const deleteAccountAction: AccountFormAction =
  accountAction("deleteAccount");
