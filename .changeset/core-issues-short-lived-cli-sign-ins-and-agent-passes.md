---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Core can now issue short-lived sign-ins for the command line and passes for
agents, in a new table of their own, `nextly_cli_credentials`, which
`nextly migrate` creates on an existing site. Nothing reaches them yet: the
sign-in command and the site's command door that use them come next, so no
behaviour changes for a site today.

- A command-line sign-in gets a 15-minute access token and a refresh token
  that is replaced every time it is used. It ends after 30 days unused, and
  90 days after sign-in in any case.
- A refresh token used again after it was replaced ends that sign-in and
  every pass made from it, since its owner and someone else now both hold
  it. A made-up token carrying a known sign-in's id is refused without
  ending anything.
- An agent pass lasts 4 hours, never longer than the sign-in it came from.
- Deactivating a person, or an administrator setting their password, ends
  every sign-in and pass they hold, as it ends their admin sessions; a
  reactivated person gets none of them back.
- Only a SHA-256 hash of each refresh token is stored; access tokens are
  signed, never stored.
- Each credential has one purpose and opens one door: CLI sign-ins and agent
  passes the command door, chat-app passes the chat-app door. None of them
  is accepted as an admin session, and an admin session is not accepted at
  either door. A revoked credential is refused on its next call.
