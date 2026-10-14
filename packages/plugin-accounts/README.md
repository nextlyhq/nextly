# @nextlyhq/plugin-accounts

Site accounts for Nextly: the visitors of a site, such as a shop's buyers, sign
up, verify their address, sign in and look after their own account. A site
account is its own kind of signed-in person and can never reach the admin.

**Status:** in development, `@experimental` throughout, and not yet published.

## Server functions

`accountsServer()` gives a site's server code the plugin's typed functions,
one for every action a visitor takes: `signUp`, `verifyAddress`,
`resendVerification`, `removeUnverifiedAccount`, `signIn`, `signOut`,
`signOutEverywhere`, `requestPasswordReset`, `resetPassword`,
`changePassword`, `changeAddress`, `confirmAddressChange`,
`cancelAddressChange`, `deleteAccount` and `currentAccount`. Another plugin
reaches the same functions with `accountsServices(ctx)`.

Each takes the visitor, read from a request with `visitorFrom`, and answers
the cookie changes for the caller to write with `cookieWrite`; a refusal is
thrown with one of the plugin's stable `ACCOUNTS_*` codes. The functions do
not check where a request came from, so code acting on a browser's request
calls `checkOrigin` first. The REST endpoints are these same functions behind
the plugin's origin and CSRF checks.

## Next.js

`@nextlyhq/plugin-accounts/next` is the only entry that imports Next.js, which
is an optional peer dependency.

- **Server actions** for every action above (`signInAction` and the rest),
  shaped for React's `useActionState`, so their forms work before JavaScript
  loads. Each is a plain async function: re-export it from a `"use server"`
  file of the site's own. Form fields carry the names the REST endpoints read
  (`address`, `password`, `token`, `code`, `currentPassword`, `newPassword`,
  `newAddress`), and a `next` field sends the visitor on afterwards, only ever
  to a path on the site's own origin.
- **`requireAccount({ returnTo })`** answers the signed-in account in a server
  component, or sends the visitor to the site's sign-in page and back to
  `returnTo`. `currentAccount()` answers the account or `null`.
- **Pages a link from an email lands on** show what the link will do and spend
  its token only when the visitor confirms with a form, never on opening. They
  send no referrer: `export const metadata = linkPageMetadata`, and
  `linkPageHeaders(options)` in `next.config`'s `headers()`.

An action is refused unless its `Origin` (or, without one, its `Referer`) is
the site's configured origin, on top of Next.js's own check of a server
action's origin. It asks for no CSRF token: the plugin's cookies are
`SameSite=Lax` and HTTP-only, and only its REST endpoints, which any page can
reach, need one.

A visitor who signs in stays signed in across browser restarts until they sign
out or the session runs out. Say so beside the sign-in button, so a visitor on
a shared computer knows to sign out.
