---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Core authentication hardening, and the runtime surface a stateful plugin needs.

## Authentication

Locked, unverified and deactivated accounts could still receive a session.
Only the password strategy checked account state, and `issueSession` trusted
whichever caller reached it, so any other strategy minted a session for an
account the password path would have refused. Three handlers re-checked
`isActive` on their own, and a path that forgot simply issued the session.

One gate now decides whether an account may hold a session, and every path that
ends in one asks it: password login, challenge resolution, the forced
first-sign-in password change, refresh, the plugin path that follows, and the
Direct API's `nextly.login()`. That last one signs a 30-day token from a
password, so it now checks credentials through the login endpoint's own
check: a wrong password counts toward the lockout, and a locked, deactivated
or unverified account is refused as the endpoint refuses it. An account that
must replace an admin-set password is refused too, since the forced change
is a step only the login page can complete. It runs no plugin login hooks
and no second-factor challenge, so it is for trusted server code rather than
for signing a person in. Each
refusal carries the same public error, so the gate cannot be used to tell a
locked account from an unknown one.

The one refusal that is named is an unverified address, and only after the
password has been proven correct: login answers `EMAIL_NOT_VERIFIED` (403),
so the login page can show its "Resend verification email" action instead of
a dead-end "Invalid email or password". Whoever receives it already holds the
password; a wrong password, and every other refusal, still answer
`AUTH_INVALID_CREDENTIALS`, and a locked account answers generically even to a
correct password, as does one an administrator deactivated, since no
verification link is sent to it. The Direct API's `nextly.login()` answers the
same way.

Resending a verification email now does nothing for an address that is
already verified, answering the same as for an unknown one; previously it
mailed a fresh link to any account. The resend endpoint is also held to the
same per-IP budget as `forgot-password`, since both send an email on request.

An administrator's deactivation now outlasts the account's own links. The
`users` table gains a nullable `deactivated_at` column, added in place by the
core schema sync with no row rewritten. Setting `isActive: false` records it,
even on an account that was already inactive, such as a sign-up still waiting
on its link; setting `isActive: true` clears it. While it is set, a
verification link verifies the address but no longer activates the account, no
new verification link is sent, and an invite link is refused without setting a
password. Previously any of these switched the account back on. Minting a new
invite for such an account answers `CONFLICT` with a message to activate it
first, rather than handing out a link that could never be accepted. Accounts
deactivated before this release carry no record, so deactivating them again is
what protects them.

A refresh whose account is no longer usable now deletes the refresh row and
clears the cookies rather than answering 401 and leaving both alive, so an
account deactivated mid-session loses it at the next rotation. The password
attempt lockout applies to password logins only: a refresh is not a password
attempt, and someone else guessing a password must not end a session that is
already established.

Any HS256 token signed with `NEXTLY_SECRET` that carried a `sub` was accepted
as a session. The session verifier refused only the one token kind it had been
told about, and the account-state endpoint did not check even that, so a token
minted for a different job — a mid-challenge pending token, or anything a
future flow signs with the same secret — could be presented as a sign-in.

Every token now carries a JWS `typ` header naming what it is for, and a token
is verified for one purpose: a header naming another purpose is refused. The
signing algorithm is pinned explicitly at the same time, so a token declaring
`alg: "none"` cannot talk the verifier out of checking the signature.

This release still accepts a session token with no `typ` header, so tokens
already in circulation keep working; a later release will require it, which
will stop Direct API tokens minted before this change. Browser sessions are
unaffected either way, because access tokens rotate every fifteen minutes.

A custom user field named `typ` can no longer reach the claims, where it would
have been read as a token kind.

A `customizeClaims` hook can add claims but no longer change the identity or
token claims. `sub`, `email`, `name`, `image` and `roleIds`, and the token's
own `iat`, `exp`, `jti`, `nbf`, `aud`, `iss` and `typ`, are restored as core
built them after every hook has run, whether a hook replaced, changed in place
or deleted them. A hook that returned a different `sub` or `roleIds` signed a
session for another account, or with other roles, that the account-state gate
never saw. A plugin that renamed a core claim now adds its own spelling beside
it instead.

An `afterAuthenticate` hook can change the user's details or pause the login
with a challenge, but only for the account that authenticated. A hook that
returns a user with a different id, a challenge for a different `userId`, or
no user at all now fails the login with an internal error, because what it
returns is what the session or pending token is issued for.

The forced first-sign-in password change checks the account before changing
the password, not only at the session afterwards, so an account deactivated or
unverified since its pending token was issued cannot set its credentials.

A self-registered account was marked as having a verified email address the
moment it was created. Creating a user with a password set `emailVerified`
straight away, and registration supplies a password, so the verification email
sent afterwards changed nothing: `requireEmailVerification` blocked nobody, and
anything that trusts the verified flag was trusting an address the account
holder had merely typed.

Creating a user now says explicitly whether anything established the address.
An operator who types someone's password vouches for it, as before, and that
path is unchanged. Registration does not, so the account stays unverified until
its verification link is followed. Callers that say nothing get the unverified
account, because a caller that forgets to say is the one whose claim should not
be believed.

Operators upgrading should know that accounts self-registered before this
change carry a verified flag nothing proved. They are not rewritten
automatically — that would sign out anyone relying on it. To review them, look
for users with a password, not created by an admin, whose `emailVerified` is
within a second of `createdAt`.

Login audit rows now record which strategy authenticated the attempt, on both
the success and the failure row, and the failure row still names no account.
Previously the trail could say that a login succeeded or failed but not by what
method, which is the first thing worth knowing when a sign-in provider turns
out to be compromised.

The strategy survives a second factor: it is signed into the short-lived
pending token, so the session minted when the challenge is answered records the
method that actually authenticated the person rather than the one that answered
the challenge.

`runStrategyChain` now returns `{ outcome, strategyName }` instead of the
outcome alone. It is exported from `nextly/auth/pipeline`, so an application
calling it directly needs to read `.outcome`.

A plugin that has authenticated someone elsewhere — an OAuth callback, say —
can now finish the login through the core session path with
`ctx.auth.completeLogin`. It applies the same account-state rules, the same
hooks and the same audit trail as a password login, so a plugin cannot grant a
session core would have refused, and every plugin fails the same safe way.

Preconditions run before any hook that could act, so an account that may not
hold a session never triggers a second-factor code being sent to it. The
password-attempt lockout does not apply, because an external login is not a
password attempt and otherwise anyone knowing an address could lock its owner
out of their provider.

A login interrupted by a second factor now resumes without a token ever
appearing in a URL. The pending token travels in an HttpOnly cookie and the
login page asks `GET /auth/pending` which challenge is outstanding; the token
itself is never returned to the page.

`ctx.auth.currentUser(request)` reports the signed-in user for a plugin route
that behaves differently when someone is already signed in.

Breaking, for plugins that contribute a challenge view: the host now posts the
answer, and the component receives `resolve(response)` instead of posting the
`pendingToken` itself. A resumed login has no token in the browser to hand it.
`pendingToken` stays in the props for one minor, deprecated, and is undefined
in resume mode. `onResolved` receives the path to land on.

`createExternalUser` creates an active, email-verified account with no password,
for an identity a trusted provider has already verified. A passwordless
`createLocalUser` makes an inactive invite carrying a set-password link, which
is the wrong shape for someone who has just signed in with a provider.

It refuses two things as policy. It will not create the first account on an
install, because that account decides who administers the site and a login
provider must never be what mints it. And it will not assign the super-admin
role, so the highest privilege is never reachable by arriving through a
provider.

Roles are validated and assigned inside the same transaction as the account.
`createLocalUser` assigns them afterwards and swallows failures, which can
leave an active account holding fewer privileges than it was created with and
nothing to say so.

## The plugin runtime

Plugins can now declare what they may do, and the runtime holds them to it.
None of this is a sandbox — Nextly runs plugins as trusted code — but a
manifest makes a plugin's reach legible before it is installed, and the
surfaces below exist only for a plugin that asked for them.

**Capabilities, and what a plugin provides or requires.** An invalid manifest
fails boot with the plugin named, rather than becoming a surface that quietly
does not exist.

**`onReady`**, which runs after every plugin has initialised and routes are
registered — the first moment the assembled system is readable. `onInstall`
and `onUninstall` are typed and never called by a boot.

**`ctx.settings`**: one store per plugin, validated by the plugin's own zod
schema, with the paths named in `capabilities.secrets` encrypted at rest and
readable across a secret rotation. Secret paths may be nested and may use `*`.
A secret is never returned to the browser: the admin sees `{ set }`.

**`ctx.fetch`**, limited to declared hosts. A hostname allowlist alone does not
prevent server-side request forgery, so names are resolved here, every answer
is vetted, and the request is sent to the address that was vetted — closing the
window in which a name resolves differently for the check than for the request.
Private, loopback, link-local, metadata, documentation (TEST-NET) and other
reserved addresses are refused, including the IPv6 ways of writing them, and
every redirect is re-checked. A redirect
that would send the request body to a different origin is refused: a body can
carry a credential — an OAuth `client_secret`, say — as surely as a header,
and the headers are already dropped at that boundary. A request body over
10 MB is refused, whatever its type.

**`ctx.audit`**, which writes only the kinds a plugin declared, namespaced
under its own slug, with metadata keys allowlisted per kind.

**Route options** — `rateLimit`, `rawBody`, `csrf` and `noStore` — the
protections core's own routes have. CSRF applies only to cookie-authenticated
callers, because a browser cannot attach an API key cross-site; declaring it on
a public route fails boot.

**Declared hook points**, collision-checked and owned by prefix, plus
`ctx.filters.decide` for seams where handlers veto rather than transform.
Decisions fail closed: a handler that throws denies, and a handler may only
keep or downgrade a verdict, so load order cannot decide access.

**`user.created` and `user.deleted` events**, so a plugin can clean up what it
stored against a user. The webhook outbox row is durable but reaches nothing
inside the process.

**SDK additions**: `sanitizeAdminPath`, `ctx.auth.verifyCsrf`,
`collectDeclarations`, and `@nextlyhq/plugin-sdk/db` — Drizzle's query
operators re-exported through core, so a plugin shares core's instance rather
than a second copy whose internal symbols match nothing. `ctx.auth.verifyCsrf`
reads the token from the `x-csrf-token` header or a JSON body's `csrfToken`,
through the same bounded reader as the route option: it reads at most 64 KB of
a body looking for it and refuses a larger one with `reason: "body-too-large"`,
so a large request carries the token in the header.

**Breaking.** The account-link endpoints are removed:
`GET /api/users/{id}/accounts` and
`DELETE /api/users/{id}/accounts/{provider}/{providerAccountId}`, along with
the `getAccounts`, `deleteUserAccount` and `unlinkAccountForUser` service
methods behind them. They read an `accounts` table nothing has written since
the auth rewrite, so they could only ever answer with an empty list or a
not-found, and a route that cannot return data invites clients to build
against it.

The relational `query` namespace is also gone from the plugin-facing database
type. It named a handful of core tables, so it could never answer about a
plugin's own tables; reads go through the fluent Drizzle API or the typed
services.

External identities are not affected: they are the subject of the plugin
identity tables that arrive with the auth plugin, not of this table.

**Breaking for fresh installs.** Nextly no longer creates the `accounts` and
`sessions` tables. They came from an authentication model it no longer uses:
sessions are stateless JWTs with their own refresh-token table, and an external
identity belongs to the plugin that authenticated it.

An existing database keeps both. Dropping a table that may hold rows is the
operator's decision rather than an upgrade's, so Nextly warns once at startup,
naming each table still present and how many rows it holds, and changes
nothing. `nextly migrate` with `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` drops them;
one that still holds rows additionally needs `NEXTLY_DROP_NONEMPTY_RETIRED=1`,
because accepting a schema change is not the same decision as accepting the
loss of rows nothing can recreate.

Both names stay reserved, so a collection cannot take a name that an existing
database still has a table under.

The `accounts` and `sessions` Drizzle tables are no longer exported from
`nextly/schemas` either, and their definitions are gone from every dialect: a
table Nextly neither creates nor writes has no schema object to offer. Code
that still reads one of them on an existing database declares the table
itself, with Drizzle's `pgTable`, `mysqlTable` or `sqliteTable` and only the
columns it reads.

A login provider button can now carry an `href`, and the login page renders it
as a link. Previously a provider that did not ship its own React component
rendered a button with no handler behind it: it looked like a way to sign in
and did nothing, so only providers shipping a component could start a flow.

The path is validated where it is served: exactly one leading slash and a
second character that cannot begin an authority, which rejects absolute URLs,
protocol-relative paths and the backslash forms. A login button is the most
valuable place on a site to plant an open redirect. It is deliberately not
required to sit under `/admin/api`, because that base path is configurable and
a plugin may mount its routes at the root.

Plugin-contributed login slots also render where their names say. Everything
was previously rendered below the form, which made `beforeForm` describe
nothing and put provider buttons underneath the password field they are an
alternative to.

Plugin routes now check CSRF by default: an unsafe-method request admitted

by a session cookie must present the double-submit token, the same

protection core's own routes take, unless the route opts out with

`csrf: false`. API-key and Bearer callers are exempt either way — a browser

cannot attach those cross-site — and a public route skips the default (it

authenticated no one), while a public handler that resolves the session user

declares `csrf: true`; only cookie-carrying callers are asked for a token.

The SPA holds the readable csrf cookie and sends the token already.
