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

## Closing sign-up

Sign-up is open by default. A site where only the people it chooses may have
an account closes it:

```ts
accounts({ origin: "https://example.com", signUp: "closed" });
```

Closed, every sign-up is refused with `ACCOUNTS_SIGN_UP_CLOSED` (403), through
the server function, the REST endpoint, the server action and another
plugin's service alike. The refusal comes before anything the visitor sent is
read, so a free address and one that has an account are answered the same,
and nothing is counted, hashed or emailed. Accounts made before sign-up
closed keep signing in.

## Ending someone's access

Staff end an account's sessions, deactivate it and reactivate it from its
page in the admin. A site's own server code does the same through three
server functions, for when its own records say someone's access has ended:

```ts
const server = await accountsServer();
await server.endAccountSessions({ accountId });
await server.deactivateAccount({ accountId });
await server.reactivateAccount({ accountId });
```

Each has the effect of staff's action of the same name.
`endAccountSessions` signs the account out everywhere, so its next request
has no account; links and codes already emailed keep working.
`deactivateAccount` also voids every link and code, cancels a pending change
of address, and keeps the account from signing in until
`reactivateAccount`. Other plugins hear of a deactivation and a reactivation
through the plugin's events.

Each is recorded in core's audit log, under
`nextlyhq-plugin-accounts.app.sessions-ended`, `.app.deactivated` or
`.app.reactivated`, naming the account and no staff member. An id that names
no account is refused with `ACCOUNTS_NOT_FOUND`; deactivating a deactivated
account, or reactivating an active one, with `ACCOUNTS_NOT_APPLICABLE` and
`data.reason` `"already-deactivated"` or `"already-active"`. None of these
take a visitor, so never reach them from a visitor's request without the
site's own check that its caller may.

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
