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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
"create-nextly-app": patch
"nextly": patch
---

A site can invite people to make accounts. `@nextlyhq/plugin-accounts`'s server functions gain `invite`, `withdrawInvitation` and `acceptInvitation`. `invite` works with sign-up open or closed and mints a link through core's one-purpose secrets: kept only as a hash, for one address, lasting `invitationLinkDays` (7 by default, 1 to 30), and replacing the address's earlier link. The plugin emails it with a new `accounts-invitation` template unless `sendEmail` is false, and answers an address that already has an account alike. `acceptInvitation` makes the verified account for the invited address with the password chosen, held to every password rule, signs it in, and hands back the `data` the site invited with. Two uses of one link at once make exactly one account. Accepting is also offered as `acceptInvitationAction` and `POST /invitation/accept`, and other plugins hear `nextlyhq-plugin-accounts.invitation.accepted`.
