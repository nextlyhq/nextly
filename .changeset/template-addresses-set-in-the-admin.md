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

A collection created at runtime, in the Schema Builder, can now be served under a template address set in the admin, with no restart: its template stores the address (a new `address` field on the page builder's templates), and its published entries are served at `<address>/<slug>` once the template is published. Setting or changing an address needs a new permission of its own, `manage-template-routing` ("Manage template routing"), apart from updating templates: the field takes the address out of a save by anyone without it, through the admin, REST or the Direct API, and the template form shows it read-only to them. A stored address is judged as a code-declared one is (its one spelling, outside the paths the runtime keeps, not `/`), and is refused, naming the other collection, when another collection is given it in code or stores it; an address declared in code wins over a stored one, and a code-declared address that another collection stores refuses to start. Changing a published template's address moves every entry: the old addresses are freed and the new ones claimed, an entry whose new address another document holds waiting until it is given up. The template actions gain `set-template-address` (experimental), with a dry run, which asks for the routing permission first and answers how many entries wait. Templates now appear in the page builder's menu, listing each template's collection and address. `nextly db:sync --promote` prints the `pageBuilder({ templates: { addresses } })` line for a promoted collection whose template stores an address.
