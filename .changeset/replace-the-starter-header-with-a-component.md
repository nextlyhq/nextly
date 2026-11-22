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

While a page shows the fresh site's starter header or footer, its card in the builder's sidebar now offers "Use a component ▾". It lists the published components marked "Use as: Header" (or "Footer"), each with a small picture, and the one chosen replaces the starter in the header & footer set it comes from, published, so the canvas and every page using that set show it at once. The starter stays in Components to choose again. It is offered only to someone who may update and publish header & footer sets, and a set holding changes not published yet is refused with a sentence saying so, since publishing the area would ship them too.

Two new routes do this, under the page builder's own namespace: `GET /layouts/area-components?area=header` lists the published components marked for an area (as the caller, with their pictures on `pictures=1`), and `PATCH /layouts/:id/areas/:area` with `{ "component": "<id>" }` puts one in a set's area, judged as the caller after checking they may update and publish sets.
