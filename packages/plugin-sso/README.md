# @nextlyhq/plugin-sso

Single Sign-On for Nextly — Google, Microsoft (Entra ID) and GitHub.

> **Alpha, `@experimental`.** This plugin is built on Nextly's auth
> extensibility surface (D71/D57), which ships `@experimental` until a
> first-party plugin exercises it in production. Pin your versions.

## What it does, and what core keeps

Core keeps everything security-critical and identical for every login method:
session issuance, JWT signing, cookies, CSRF, rate limiting, account lockout
and the audit trail. This plugin supplies the one thing core cannot know —
which external identity a person just proved, and which local user that maps
to.

That division is why an SSO login composes with the rest of the system for
free: a second factor contributed by another plugin still runs, custom JWT
claims still apply, and the login still appears in the audit log.

## Status

Phase 1 of the implementation: the configuration surface and the cryptographic
primitives behind the redirect flow. The provider adapters, the plugin
definition and the auth strategy follow.

The package is marked `private` until it is functional, so the release train
skips it. A package that publishes before it can authenticate anyone would ship
a `@nextlyhq/plugin-sso` that installs and does nothing — and the name has to be
claimed on npm with a placeholder before its first real release anyway. Both
happen together in the final phase.

| Piece                           | State      |
| ------------------------------- | ---------- |
| Options parsing and validation  | shipped    |
| PKCE, `state`, `nonce`          | shipped    |
| Signed transaction cookie       | shipped    |
| Login handoff token             | shipped    |
| Same-origin redirect validation | shipped    |
| Generic OIDC adapter, Google    | next       |
| Microsoft (Entra ID), GitHub    | after that |
| Auth strategy, routes, admin UI | after that |

## Configuration

```ts
// nextly.config.ts
import { defineConfig } from "nextly/config";
import { ssoPlugin, ssoStrategy } from "@nextlyhq/plugin-sso";

const sso = {
  // Absolute public origin. Never derived from the request: the redirect URI
  // must match the provider's registered value byte for byte, and a value read
  // from a Host header is attacker-controlled.
  baseUrl: process.env.NEXTLY_PUBLIC_URL!,
  autoProvision: false,
  defaultRoleSlug: "viewer",
  providers: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      hostedDomains: ["acme.com"],
    },
    microsoft: {
      clientId: process.env.MS_CLIENT_ID!,
      clientSecret: process.env.MS_CLIENT_SECRET!,
      tenant: "common",
      allowedTenantIds: [process.env.MS_TENANT_ID!],
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      allowedOrgs: ["nextlyhq"],
    },
  },
};

export default defineConfig({
  plugins: [ssoPlugin(sso)],
  // Strategies are enabled by the APP, never by installing a plugin.
  // Installing this package does not let it authenticate anyone until you
  // list its strategy here.
  auth: { strategies: [ssoStrategy(sso)] },
});
```

## Redirect URIs

Register these in each provider's console. The path is fixed: the host mounts
the Nextly request handler at `/admin/api`, and the route registry serves a
plugin's routes under `/plugins/<package name>`.

```
https://your-site.example/admin/api/plugins/@nextlyhq/plugin-sso/callback/google
https://your-site.example/admin/api/plugins/@nextlyhq/plugin-sso/callback/microsoft
https://your-site.example/admin/api/plugins/@nextlyhq/plugin-sso/callback/github
```

Use `redirectUri(baseUrl, provider)` rather than typing them: a token exchange
whose `redirect_uri` differs by one character from the authorize request is
rejected by every conforming provider, with an error that names neither value.

## Security model

- **Authorization Code with PKCE (`S256`)**, per OAuth 2.1 and RFC 9700. `state`
  anchors CSRF, `nonce` prevents ID-token replay, PKCE prevents code
  interception; all three are sent wherever the provider supports them.
- **Account linking requires a verified email.** Linking a provider identity to
  an existing local account on an unverified address lets anyone who can
  register that address at the provider take the account over. GitHub emails
  must be both primary and verified; Google and Entra must assert
  `email_verified`.
- **Auto-provisioning is off by default.** With a public provider, on means
  anyone the provider will authenticate can obtain an account unless a domain
  or organisation allowlist narrows it.
- **A multi-tenant Entra authority requires a tenant allowlist.** On `common`
  the issuer is per-tenant, so validating `iss` proves only that some Microsoft
  tenant signed the token. The plugin refuses to boot without one.
- **Purpose-derived signing keys.** Nothing here is signed with the raw
  `NEXTLY_SECRET`, so no token this plugin mints can be presented as a session.
- **Stable provider subjects.** GitHub identities key on the numeric `id`, never
  the login, which is renameable; Entra identities key on `oid` + `tid`, never
  `sub` or email.

## License

MIT
