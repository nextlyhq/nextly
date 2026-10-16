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
---

Form Builder and the blog template now decide access by the permissions a role holds on the Roles screen, never by a role's name.

**Behaviour changes.** Form Builder's default rules used to let any signed-in user read every submission and edit every form, and only users with a role named `admin` delete either. Each now needs the matching permission: `read-form-submissions`, `update-forms`, `delete-form-submissions`, and so on. A visitor can still read a form and submit one. Give your staff roles the permissions they need on the Roles screen; super-admins are unaffected.

The blog template's rules used to admit roles named `admin`, `editor` or `author`, so a custom role or an API key holding `update-posts` was refused. They now check the permission instead, and the seeded **author** role no longer holds `delete-posts` or `publish-posts`: an author can no longer delete or publish posts, their own or anyone else's, and an editor publishes. This applies to newly seeded sites; an existing site keeps the roles it has.

The documentation now gives one rule for code access: check the permission, then narrow it, and don't check role names.
