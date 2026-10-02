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

## Upgrading

**Run `nextly migrate` before deploying this release.** It adds the nullable
`users.deactivated_at` column and the `nextly_plugin_settings` table. Boot
applies it on its own in two cases: with `NODE_ENV=production` when
`db.runMigrationsOnBoot` is on, and with `NODE_ENV=development` unless
`NEXTLY_DISABLE_BOOT_APPLY=1` is set or the app has no migrations directory.
Otherwise boot only warns about a schema that is behind, and password login
and token refresh read whole `users` rows, so on an unmigrated database every
login and refresh fails until the migration runs.

## Breaking changes

Each is described in its section below; listed here so none is missed.

- **Plugin routes check the request origin by default** for unsafe methods
  from a session-cookie caller, and answer `403 CSRF_FAILED` when it is not
  this site or an allowed origin. API-key and webhook callers are never
  checked and need no opt-out; a webhook route is `public: true`.
  `csrf: false` makes a route refuse every unsafe request the session cookie
  authenticates, and cannot be combined with `public: true`: boot refuses
  such a route, naming the plugin and the route.
- **A `customizeClaims` hook can only add claims.** Every claim core built —
  identity, `roleIds` and the token claims — is restored as core built it, a
  claim named after a configured user field can be neither added nor changed,
  and the reserved token claims cannot be added. Add your own claim beside a core one instead of changing it.
- **An `afterAuthenticate` hook that returns another account fails the
  login.** Change the user's details, never its id.
- **Challenge views no longer post the answer.** They receive
  `resolve(response)` and call it; `pendingToken` is deprecated.
- **A wrong code at `POST /auth/challenge/resolve` answers in the canonical
  error envelope.** The 401 was a top-level
  `{ status, challengeType, pendingToken, error: "Invalid code." }`; it is now
  `{ error: { code: "AUTH_INVALID_CREDENTIALS", message, requestId, data } }`,
  where `data` is `{ status, challengeType, pendingToken }`, with no
  `pendingToken` when the pending token came from the cookie, which the
  re-issued one replaces. A view that still posts its own answer reads the
  next token from `error.data.pendingToken`.
- **`routeAuthRequest` and `AuthRouterDeps`, exported from `nextly/auth`, are
  marked `@experimental`, and `AuthRouterDeps` changed.** It requires
  `fetchAccountState` and `withSessionRowTransaction`, and `findUserByEmail`
  returns a `CredentialUserRow`, which adds `deactivatedAt` and
  `passwordUpdatedAt` and makes `passwordHash` nullable. Code that builds the
  deps itself supplies both and handles a row with no password;
  `CredentialUserRow`, `AccountState`, `SessionRowTransaction` and
  `WithSessionRowTransaction` are exported from `nextly/auth` to name them.
  `AccountState.passwordUpdatedAt` is required (`Date | null`), so
  `fetchAccountState` and `withSessionRowTransaction` return the column as
  stored, and `setInitialPassword` returns `{ userId, passwordUpdatedAt }`.
- **`createLocalUser` defaults to an unverified address** for a caller that
  says nothing. `nextly.users.create` and `ctx.services.users.create` still
  default to `admin-vouched`, because they are the host's own server code;
  pass `emailVerification: "pending"` there for a self-supplied address.
- **`nextly.login()` applies the login endpoint's account checks.** It
  refuses a locked, deactivated or unverified account, and one that must
  replace an admin-set password, and a wrong password counts toward the
  lockout. Bring the account into a usable state first, or sign the person in
  through the login page.
- **`runStrategyChain` returns `{ outcome, strategyName }`.** Read `.outcome`.
- **`ctx.db` without `capabilities.db.rawSql` is a restricted handle** with
  `select`, `insert`, `update`, `delete` and `transaction` only: `execute`,
  `run`, `selectDistinct`, `$count`, `with`/`$with` and `batch` are gone, as is
  the relational `query` namespace. Declare `rawSql` for the live instance.
- **`ctx.events.emit` refuses core event names** (`plugin.`, `collection.`,
  `auth.`, `document.`, `media.`, `user.`), and a plugin declaring an event
  under one of those prefixes fails boot. Use your plugin's own prefix.
- **The account-link endpoints and their service methods are removed.**
- **`accounts` and `sessions` are no longer exported from `nextly/schemas`.**
  Code that imports them stops compiling; declare the table yourself with only
  the columns you read. Fresh installs no longer create the tables.

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
for signing a person in. Each refusal carries the same public error, so the gate cannot be used to tell a
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
same per-IP budget as `forgot-password`, since both send an email on request,
and so is `verify-email`, which consumes a single-use token as
`reset-password` does.

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
clears the cookies rather than answering 401 and leaving both alive.
Deactivating an account, or setting its password — by an administrator
(`updateUser` or `PATCH /api/users/:id/password`), by the user changing their
own, by a reset, by accepting an invite or by setting an initial password —
deletes its refresh tokens in the same transaction, so a reactivation does not
bring old sessions back. Every one of these password writes also clears
`mustChangePassword` and stamps `passwordUpdatedAt`;
`PATCH /api/users/:id/password` used to set only the hash. A user's own password change
through `userService.changePassword` is refused for a deactivated account, as
`changePassword` already was, and the Direct API's `changePassword` and
`resetPassword` end the account's other sessions too, as the REST endpoints
did. An administrator who sets their own password on the user edit page is
signed out and sent to sign in again, as is one who deactivates their own
account there. A refresh token is spent once: a rotation hands out its new
token only if it removed the presented row, so two requests presenting one
token get one rotation, and the one that loses the race answers 401
`REFRESH_SUPERSEDED` and leaves the cookies alone. The admin retries with the
cookies it now holds; any other client should retry once with its current
cookies. A spent token replayed later is still refused with its cookies
cleared. A sign-in or a rotation in
flight when the account is deactivated or its password set does not leave a
session behind: each writes its refresh row in one transaction that locks the
account's row (`FOR SHARE` on PostgreSQL and MySQL) and checks the account
again. A password sign-in, including one paused for a second factor, is
refused if the password changed after it was proven, and so is the session the
forced first-sign-in change issues if the password is set again before it is
written. An access token already issued stays valid until it expires,
within fifteen minutes; a token from the Direct API's `nextly.login()` lasts
30 days and is not ended early. The password
attempt lockout applies to password logins only: a refresh is not a password
attempt, and someone else guessing a password must not end a session that is
already established.

Any HS256 token signed with `NEXTLY_SECRET` that carried a `sub` was accepted
as a session. The session verifier refused only the one token kind it had been
told about, and the account-state endpoint did not check even that, so a token
minted for a different job — a mid-challenge pending token, or anything a
future flow signs with the same secret — could be presented as a sign-in.

Session tokens and second-factor pending tokens now carry a JWS `typ` header
naming what each is for, and a token is verified for one purpose: a header
naming another purpose is refused. Preview tokens are kept apart by their own
derived key and audience. The
signing algorithm is pinned explicitly at the same time, so a token declaring
`alg: "none"` cannot talk the verifier out of checking the signature.

This release still accepts a session token with no `typ` header, so tokens
already in circulation keep working; a later release will require it, which
will stop Direct API tokens minted before this change. Browser sessions are
unaffected either way, because access tokens rotate every fifteen minutes.

A custom user field named `typ` can no longer reach the claims, where it would
have been read as a token kind.

A `customizeClaims` hook can add claims but no longer change any claim core
built. `sub`, `email`, `name`, `image`, `roleIds`, and the token's own `iat`,
`exp` and `jti` are restored as core built them after every hook has run,
whether a hook replaced, changed in place or deleted them; the reserved `nbf`,
`aud`, `iss` and `typ` cannot be added. A claim named after a configured user
field can be neither added nor changed by a hook, and one whose value could
not be read is left out rather than set to null. A hook that returned a different `sub` or `roleIds` signed a
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
`ctx.auth.completeLogin`. It must declare `capabilities.auth.login`, and its
strategy names must begin with its own slug (`acme-google-auth:google`), so the
manifest shows the plugin can sign people in and every audit row names it. It applies the same account-state rules, the same
hooks and the same audit trail as a password login, so a plugin cannot grant a
session core would have refused, and every plugin fails the same safe way.

Preconditions run before any hook that could act, so an account that may not
hold a session never triggers a second-factor code being sent to it. The
password-attempt lockout does not apply, because an external login is not a
password attempt and otherwise anyone knowing an address could lock its owner
out of their provider.

A login interrupted by a second factor now resumes without a token ever
appearing in a URL. The pending token travels in an HttpOnly cookie and the
login page asks `GET /auth/pending` which challenge is outstanding, and that
endpoint never returns the token itself. (A password login still returns its
challenge token in the response body, as before.) A correct answer whose
session is refused after it settled the flow clears the pending cookie, and
`GET /auth/pending` answers 204 for a flow whose attempt budget is spent, so the
login page stops offering a challenge nothing can finish.
`RateLimiter.peek(key, windowMs)` is new: it reads a key's count without
spending an attempt.

`ctx.auth.currentUser(request)` reports the signed-in user for a plugin route
that behaves differently when someone is already signed in.

Breaking, for plugins that contribute a challenge view: the host now posts the
answer, and the component receives `resolve(response)` instead of posting the
`pendingToken` itself. A resumed login has no token in the browser to hand it.
`pendingToken` stays in the props for one minor, deprecated, and is undefined
in resume mode. When an answer finishes the login, the host navigates to the
login's destination itself; `onResolved` chooses where to land only for a view
that still posts its own answer with `pendingToken`.

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

**Capabilities, and what a plugin provides or requires.** The manifest's shape
is checked before anything reads it, and boot fails with the plugin named for:
an unknown key anywhere inside `capabilities`, a value of the wrong type, an
outbound entry that is not a hostname (IP literals included), an empty or
unparseable `requires` range, secrets without a settings schema, a duplicate,
unknown or group-naming secret path, a secret path to a value that cannot
be a string (a number or a boolean, say), a challenge id core reserves or
another enabled plugin also declares, a settings key or plugin name too long
for storage, and a `schemaVersion` that is not a positive integer.
`nextly plugins info <name>` prints the manifest: outbound hosts, raw SQL,
whether it finishes logins, secret paths, and what it provides and requires. Capability names are
global; prefix them with your vendor (`acme/auth-provider`).

**`onReady`**, which runs after every plugin has initialised and routes are
registered — the first moment the assembled system is readable. There are no
install or uninstall hooks yet: they arrive with the install command.

**`ctx.settings`**: one store per plugin, validated by the plugin's own zod
schema, with the paths named in `capabilities.secrets` encrypted at rest.
Secrets are sealed with AES-256-GCM under a key derived with HKDF once per
`NEXTLY_SECRET` generation, with the plugin and path authenticated as
associated data, and labelled with the generation that sealed them. A value
sealed under `NEXTLY_SECRET_PREVIOUS` is re-sealed under the current secret
when read; one no configured secret can open shows as
`{ set: true, readable: false }` and can be overwritten; `get()` logs why
such a value could not be opened: a malformed envelope, a key the install no
longer configures, or a failed authentication. A value stored
encrypted stays encrypted, and redacted in the admin, even after a plugin
update stops declaring its path. `set` is a JSON merge patch, so `null`
removes a key at any depth, and an unknown key is refused at any depth. One
key's stored value, after encryption, holds at most 256 KiB on every dialect
(MySQL stores it as `mediumtext`). Settings a newer plugin version no longer
accepts still render in the admin with the problems listed, and `get()` throws
an internal error whose log names them. A secret is never returned to the
browser: the admin sees `{ set }`. An operator's change is recorded in the
activity log by key name, and every change is announced in-process as
`plugin.settings.changed`.

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
10 MB is refused, whatever its type. The `CONNECT`, `TRACE` and `TRACK`
methods and caller-set `Upgrade`, `Keep-Alive` and `Expect` headers are
refused, as is a `Connection` header other than `close` or `keep-alive`; those
two are dropped, because the transport manages its own connection. An answer
that switches protocols (`101`) is refused rather than left pending.

**`ctx.audit`**, which writes only the kinds a plugin declared — `<slug>.`
followed by lowercase letters, digits, `.`, `_` and `-` — with metadata keys
allowlisted per kind and values with a known credential shape dropped.
Deleting a user clears the metadata of every plugin row naming them, as actor
or target. A `targetUserId` must name an existing user: a row naming one that
does not exist is stored without its metadata, and a warning is logged.

**Route options** — `rateLimit`, `rawBody`, `csrf` and `noStore` — the
protections core's own routes have.

`rateLimit` takes `"auth"`, `"general"`, or `{ max, windowMs }`, and counts
each route path separately, with IPv6 clients counted by their /64. Without
`security.trustProxy` no client address is read, so every client shares one
limit, and boot names each rate-limited route when that is the case.

CSRF applies only to callers the session cookie admitted, because a browser
cannot attach an API key cross-site. By default an unsafe-method request must
come from this site or an allowed origin, which the admin's own requests do
without a token; `csrf: true` also requires the double-submit token, and
`csrf: false` refuses every unsafe-method request the session cookie
authenticates, so the route takes writes only from callers with another
credential. A refusal answers `403 CSRF_FAILED` and records a `csrf-failed`
audit event. A public route skips the default check, and a public handler that
resolves the session user declares `csrf: true`. `csrf: false` cannot be
combined with `public: true`: boot refuses such a route, naming the plugin and
the route.

**Declared hook points**, collision-checked and owned by prefix, plus
`ctx.filters.decide` for seams where handlers veto rather than transform.
Decisions fail closed: a handler that throws denies, and a handler may only
keep or downgrade a verdict, so load order cannot decide access.

**`user.created` and `user.deleted` events**, so a plugin can clean up what it
stored against a user, with `UserEvents` and their payload types. The webhook
outbox row is durable but reaches nothing inside the process.

**SDK additions**: `sanitizeAdminPath`, `DEFAULT_ADMIN_PATH`,
`ctx.auth.verifyCsrf`, `collectDeclarations`, the runtime types
(`PluginSettingsApi`, `PluginAuditApi`, `PluginAuthApi`,
`CompleteLoginOptions`, `Decision`, `PluginCapabilities`,
`PluginAuditDeclaration`, `PluginHookPointDeclaration`, `PluginDatabase`,
`PluginRouteRateLimit`), `ChallengeViewProps` and `ChallengeResolveResult` from
`@nextlyhq/plugin-sdk/admin`, and `@nextlyhq/plugin-sdk/db` — Drizzle's query
operators re-exported through core, so a plugin uses the Drizzle version core
runs. All are experimental. `ctx.auth.verifyCsrf`
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

`ctx.db` for a plugin that does not declare `capabilities.db.rawSql` is a
restricted handle with `select`, `insert`, `update`, `delete` and
`transaction`, and no `execute` or `run`; with `rawSql` it is the live Drizzle
instance. The capability is a declaration a reviewer can read, not a sandbox:
plugins run as trusted code. `transaction(async tx => ...)` works on every
dialect, `rawSql` or not; inside it, write through `tx` — another Nextly
service or `ctx.settings` called there runs on its own connection on
PostgreSQL and MySQL, outside the transaction, and commits on its own. With
`rawSql`, `tx` is the live handle, and its `transaction` nests as a savepoint
on every dialect.

The SQLite adapter runs a `transaction()` called from inside another
transaction's work as a savepoint of it, including one made later from a
savepoint that has since released, which runs inside the innermost
transaction or savepoint still open on the connection, and rolls back with it
if that one does. It used to queue behind the transaction waiting for it, which hung both
and every later transaction on the instance. Core services' own transactions
on SQLite go through the adapter too, so one called inside a plugin's
`ctx.db.transaction` nests as a savepoint, and its rows roll back with it,
instead of failing with "cannot start a transaction within a transaction".
What it does after its own write runs when its savepoint is released and is
not undone if the plugin's transaction then rolls back: collection hooks
(`afterCreate`, `afterUpdate`, `afterDelete`), events such as `user.created` or
`plugin.settings.changed`, and cache revalidation. A core media delete
(`media.delete` or `media.bulkDelete`) called inside the transaction is
refused with `409 CONFLICT`, so stored files are never removed for a delete
that rolls back: delete media after the transaction. A focal-point change made
inside it keeps the superseded image variants rather than deleting them.
`DrizzleAdapter.inTransaction()` is new: it tells a caller whether a
`transaction()` made from there would join an open transaction as a savepoint,
and is false on PostgreSQL and MySQL, where each transaction has its own
connection. On SQLite a
plugin's transaction holds the database's only connection until it ends:
other requests' statements wait for it or run inside it, so keep it short and
never await network I/O (`ctx.fetch`) inside it. An error the plugin throws inside
`ctx.db.transaction`, `rawSql` or not, reaches it as thrown, as on PostgreSQL
and MySQL, rather than as a generic database error.

External identities are not affected: they are the subject of the plugin
identity tables that arrive with the auth plugin, not of this table.

**Breaking for fresh installs.** Nextly no longer creates the `accounts` and
`sessions` tables. They came from an authentication model it no longer uses:
sessions are stateless JWTs with their own refresh-token table, and an external
identity belongs to the plugin that authenticated it.

An existing database keeps both. Dropping a table that may hold rows is the
operator's decision rather than an upgrade's, so Nextly warns once at startup,
naming each table still present and how many rows it holds, and changes
nothing. `nextly migrate` with `NEXTLY_DROP_RETIRED_AUTH_TABLES=1` drops them
and records the drop in the schema ledger; one that still holds rows
additionally needs `NEXTLY_DROP_NONEMPTY_RETIRED=1`, and is otherwise kept with
a warning while the empty one is dropped and the rest of the run goes ahead.
Only the value `1` turns either flag on.

A table counts as one of these only when its columns match the shape Nextly
created (`accounts`: `user_id`, `provider`, `provider_account_id`;
`sessions`: `session_token`, `user_id`, `expires`), so a host application's
own table that merely shares the name is not reported, dropped or erased from.
A host table built on the same Auth.js model does match it: it is reported at
boot, the flags would drop it, and deleting a Nextly user erases that user's
id from it. If one shares the database, rename it. Deleting a user erases
their rows from both retired tables.

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

The login page lands a resumed second-factor login on its `next` rather than
the dashboard, keeps the challenge through a network failure, a rate limit or
a server error, and says so when the attempt has ended. A provider link shows
its declared icon and starts one sign-in however often it is clicked, and the
`?error` parameter is removed once read. `?resume` stays, so a reload in the
middle of a second factor finds the flow again.

The CLI resolves the plugin list a `setup` transformer leaves exactly as the
boot does, so `nextly migrate`, `build`, `db:sync` and the dev reload refuse a
transformer-added plugin the app would refuse, and see its collections and
field types.
