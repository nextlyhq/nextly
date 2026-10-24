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

A code access rule can no longer let in a signed-in user who lacks the permission on their role. The permission is asked first, and a rule only narrows it: a rule that returns `true` lets through only a user who holds the permission for that action. Before, a rule declared for an action decided alone for signed-in users, so a rule of `true` let in a user the role screen kept out. This holds for every action and wherever the rule is asked:

- **A collection or a Single.** A Single's own rule narrows the permission as a collection's does: with `read: () => true`, a user without the Single's read permission is refused.
- **Related rows.** A related row is shown only to a user who could read it directly, with the permission on their role and the target's rule. Before, the target's rule alone decided.
- **Writes.** A create or update by a signed-in user needs the permission before the collection's rule is asked. The fields such a write may set are then judged by their own rules, as before.
- `nextly.access.check` answers the same way.

To keep such a user's access, tick the permission on their role.

For this release, each request refused this way is logged once, naming the collection or Single, the action and the permission to grant.
