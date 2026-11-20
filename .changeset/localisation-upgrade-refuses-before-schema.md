---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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
---

`nextly migrate` refuses stored data it cannot bring into the localisation model (one language under two codes, pending changes saved at the same moment) before any of its migrations apply, so its "Nothing was changed" holds; a version history that only lacks the columns the run's own migrations add still upgrades. An older language spelling (`pt_BR`) is found wherever it is stored, in the versions, pins, provenance, archive, release members, media use and preview links as well as the translations, so a configuration already corrected to the standard code still has every row converted, and a start refuses until it is. `db:sync --dry-run` keeps what the steps list for an editor to check where they have no work to do.

Every text field is kept per language unless it says `localized: false`, so a collection whose declared `indexes` name a text field that is a key, never translated, is refused at start with that fix named: mark the field `localized: false`, which keeps its column on the main table. The form builder's indexed keys now say so, which lets a site using it start again. `nextly migrate` refuses a data step's problem before any schema change where it can be judged up front; one that depends on an earlier repair step is refused after that step and the schema changes, which stay applied, and says so. The dry run names such a refusal.
