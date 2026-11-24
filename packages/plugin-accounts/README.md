# @nextlyhq/plugin-accounts

Site accounts for Nextly: the visitors of a site, such as a shop's buyers, sign
up, verify their address, sign in and look after their own account. A site
account is its own kind of signed-in person and can never reach the admin.

**Status:** experimental. Published to npm with the Nextly release, and
`@experimental` throughout: its exports may change between alpha releases.

## Install

```bash
npm install @nextlyhq/plugin-accounts
```

Install it at the same version as `nextly`, then add it to the site's config
with the site's own origin, which every link in an email is built on, and run
`nextly migrate:create` and `nextly migrate` for the collections it adds:

```ts
import { defineConfig } from "nextly";
import { accounts } from "@nextlyhq/plugin-accounts";

export default defineConfig({
  plugins: [accounts({ origin: "https://example.com" })],
});
```

## Server functions

`accountsServer()` gives a site's server code the plugin's typed functions,
one for every action a visitor takes: `signUp`, `verifyAddress`,
`resendVerification`, `removeUnverifiedAccount`, `signIn`, `signOut`,
`signOutEverywhere`, `requestPasswordReset`, `resetPassword`,
`changePassword`, `changeAddress`, `confirmAddressChange`,
`cancelAddressChange`, `deleteAccount`, `acceptInvitation` and
`currentAccount`; and, for the site's own code alone, `invite`,
`withdrawInvitation`, `endAccountSessions`, `deactivateAccount` and
`reactivateAccount`. Another plugin reaches the same functions with
`accountsServices(ctx)`.

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

## Invite-only sites

A site where only the people it chooses have accounts, such as a staff
portal or a client area, closes sign-up and invites people from its own
server code:

```ts
accounts({ origin: "https://example.com", signUp: "closed" });
```

```ts
import { accountsServer } from "@nextlyhq/plugin-accounts";

const server = await accountsServer();
const { link, expiresAt } = await server.invite({
  address: "dana@example.com",
  name: "Dana Reyes",
  data: { personId: "p-17" },
});
```

`invite` works whether sign-up is open or closed, and is for the site's
code only: no endpoint or action offers it to a visitor.

- **The plugin sends the email** with its `accounts-invitation` template,
  which the site edits in the admin like its other emails. The link lands on
  `pages.acceptInvitation` (`/account/invitation` by default). Pass
  `sendEmail: false` to send the returned `link` or `token` some other way.
  Besides `{{link}}`, the template is given `{{name}}`, the name invited
  with, and when the link stops working: `{{expiresAt}}` (ISO 8601, UTC) and
  `{{expiresAtText}}`, such as "30 November 2026, 5:00 PM", written in
  `{{timeZone}}`, the plugin's `timeZone` option (an IANA name such as
  `Asia/Karachi`; UTC when unset).
- **The link** is a one-purpose link kept by core only as a hash, for that
  address alone. It lasts `invitationLinkDays` (7 by default, 1 to 30) and is
  spent once. Inviting the same address again replaces the earlier link, and
  `withdrawInvitation({ address })` withdraws it.
- **It says nothing about who has an account.** An address that already has
  one gets the same answer as any other. Its email, `accounts-invitation-has-account`,
  asks them to sign in instead, and its link is refused when used
  (`ACCOUNTS_LINK_REFUSED`, `data.reason` `"has-account"`).
- **Limits.** Invitations to one address are counted as every email the
  plugin sends to an address is: 3 in 15 minutes, 10 a day. Pass the
  `visitor` when a visitor's request asked for the invitation, so their
  client's limit applies too.
- **`data`** is a flat record of short strings, numbers, booleans and nulls,
  for the site to tie the new account to a record of its own.

The invitation page shows a password form and accepts with
`acceptInvitationAction` (fields `token`, `password`, optional `next`), the
REST endpoint `POST /invitation/accept`, or the server function:

```ts
import type { AccountVisitor } from "@nextlyhq/plugin-accounts";

declare const visitor: AccountVisitor; // read from the request with visitorFrom
declare const token: string, password: string; // the invitation page's form
const accepted = await server.acceptInvitation({ visitor, token, password });
// accepted.account.id, accepted.data, and accepted.cookies to write
```

Accepting creates the account for the invited address, with the name the
site gave and the password chosen. The password is held to every rule a new
password is, including the breached-password check where the site turns it
on, and a refused password leaves the link usable. The address counts as
verified, the visitor is signed in, and the link is spent. If the same link
is used twice at the same moment, exactly one use makes the account. With
`address`, a use that names another address is refused (`data.reason`
`"other-address"`), and nothing is spent.

Only the server function answers the account and `data`. The action and
the endpoint answer the browser with the message and cookies alone. Other
plugins hear `nextlyhq-plugin-accounts.invitation.accepted`, with the
account's id and `data`.

## Ending someone's access

Staff end an account's sessions, deactivate it and reactivate it from its
page in the admin. A site's own server code does the same through three
server functions, for when its own records say someone's access has ended:

```ts
import { accountsServer } from "@nextlyhq/plugin-accounts";

declare const accountId: string; // the account whose access has ended
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

## Related packages

- [`nextly`](../nextly) — the core whose signed-in people and one-purpose links this plugin uses
- [`@nextlyhq/plugin-sdk`](../plugin-sdk) — the SDK this plugin is built on

## License

MIT © Nextly
