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
first-sign-in password change, refresh, and the plugin path that follows. Each
refusal carries the same public error, so the gate cannot be used to tell a
locked account from an unknown one.

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
Private, loopback, link-local and metadata addresses are refused, including the
IPv6 ways of writing them, and every redirect is re-checked.

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
than a second copy whose internal symbols match nothing.

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
