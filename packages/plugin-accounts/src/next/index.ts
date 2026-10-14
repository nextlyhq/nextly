/**
 * `@nextlyhq/plugin-accounts/next`: the plugin's Next.js entry. Server
 * actions for every account action, the signed-in account for a server
 * component, and the pieces a page a link from an email lands on needs.
 *
 * The only part of the plugin that imports `next/*`, and an optional peer
 * dependency, so a site importing the plugin's root never loads Next.js
 * through it.
 *
 * **Using an action.** The actions are plain async functions, so a site
 * re-exports each from a `"use server"` file of its own, which is what makes
 * it a server action Next.js can call from a form:
 *
 * ```ts
 * // app/account/actions.ts
 * "use server";
 * import { signInAction, type AccountFormState } from "@nextlyhq/plugin-accounts/next";
 *
 * export async function signIn(state: AccountFormState, form: FormData) {
 *   return signInAction(state, form);
 * }
 * ```
 *
 * A form using it with `useActionState` posts before JavaScript loads, and
 * each field has the name the REST endpoints read (`address`, `password`,
 * `token`, `code`, `currentPassword`, `newPassword`, `newAddress`, `next`).
 *
 * **What keeps an action from being forged.** A server action is a POST to
 * the page's own address with the action's id. The plugin relies on:
 * - Next.js's own check, which refuses a server action whose `Origin` is
 *   not the host it was sent to (or a host the site lists in
 *   `serverActions.allowedOrigins`);
 * - its own check, before any flow runs, that the `Origin` (or, without
 *   one, the `Referer`) is the site's configured origin, refusing a request
 *   with neither;
 * - its cookies being `SameSite=Lax` and HTTP-only, so no other site's POST
 *   carries them and no script reads them.
 *
 * It asks for no CSRF token in an action: the REST endpoints' token exists
 * because a JSON endpoint is reachable from any page, and a server action is
 * reachable only through those checks. A site that widens
 * `allowedOrigins` widens only Next.js's check, never the plugin's.
 *
 * **Links from emails.** A link's page shows what the link will do and
 * spends its token only when the visitor confirms with a form, never on
 * opening; it sends no referrer (`linkPageMetadata`, `linkPageHeaders`), and
 * a confirming form that names a `next` takes the token out of the address
 * once it is spent.
 *
 * Everything here is `@experimental` until the plugin graduates.
 *
 * @module next
 */
export { currentAccount, requireAccount } from "./account";
export {
  cancelAddressChangeAction,
  changeAddressAction,
  changePasswordAction,
  confirmAddressChangeAction,
  deleteAccountAction,
  initialAccountFormState,
  removeUnverifiedAccountAction,
  requestPasswordResetAction,
  resendVerificationAction,
  resetPasswordAction,
  signInAction,
  signOutAction,
  signOutEverywhereAction,
  signUpAction,
  verifyAddressAction,
  type AccountFormAction,
  type AccountFormState,
} from "./actions";
export { linkPageHeaders, linkPageMetadata } from "./link-page";
