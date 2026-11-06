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

An API client or an agent can now find every id the composition actions take,
and reach the actions from server code without an HTTP round trip.

`GET /manifest` on the page builder lists the patterns, the components with
their exposed fields, slots and variants (by id and name), and the Layouts with
their regions and which is the site default, each read as the caller, with the
actions and the JSON Schema of their requests. `compositionManifestSchema`
validates it. The same manifest and the page and definition actions are a
service, `composition`, that another plugin's route calls with its own
request's context, with every check the routes make.

`@nextlyhq/builder/ops` now publishes the actions' schemas
(`pageActionSchema`, `definitionActionSchema`, and their JSON Schema forms),
`planDefinitionAction`, and the editor's planners. The routes parse with those
schemas, so a client validating against them is refused for what the route
refuses. `@nextlyhq/builder` now depends on `zod`, used only by that subpath.

A component kept in a collection of the site's own, named by
`componentReadiness`, can now be edited through `POST /components/:id/definition`;
it was refused before.
