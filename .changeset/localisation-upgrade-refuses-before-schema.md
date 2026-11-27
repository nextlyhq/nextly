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

Every text field is kept per language unless it says `localized: false`, so a collection whose declared `indexes` name a text field that is a key, never translated, is refused at start with that fix named: mark the field `localized: false`, which keeps its column on the main table. The form builder's indexed keys now say so, which lets a site using it start again. `nextly migrate` refuses a data step's problem before any schema change where it can be judged up front; one that depends on an earlier repair step is refused after that step and the schema changes, which stay applied, and says so. The dry run names such a refusal. The page builder's, the form builder's and the SEO plugin's own bookkeeping (keys, ids, languages, paths, states and actors) is never translated, and now says `localized: false`, so it stays on the main table, where a lookup by it finds it in every language.

**Upgrading a site from 0.0.2-alpha.79, 0.0.2-alpha.80 or 0.0.2-alpha.81 that uses the SEO plugin:** those releases kept the plugin's bookkeeping fields per language, so this upgrade moves them back to their main tables. That is 37 columns across `nx_seo_addresses`, `nx_seo_redirects`, `nx_seo_not_found`, `nx_seo_problems`, `nx_seo_code_pages` and `nx_seo_route_values`. `nextly migrate:create` writes the move and lists each column it removes from a `_locales` table, so back up the database and give the consent it asks for, as the upgrade guide's "From 0.0.2-alpha.79" section describes. The default language's values move to the main table. Any other language's values go to the localization archive. The SEO settings, a page's `seo` group and the editorial text of pages with no entry stay per language.
