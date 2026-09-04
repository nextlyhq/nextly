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
---

A page now loads the components it embeds. Placing a reusable component on a
page drew nothing on the served site, because nobody was fetching the
component: the renderer knew how to draw one and was never handed it.

A page reads every component it references in one query, follows a component
that holds another as far as a page can draw it, and reads them at the same
posture as the page itself — so a published page draws published components and
a draft preview draws drafts. Sites that store components somewhere of their own
can say where, or supply them directly.

Publishing one component now rebuilds exactly the pages that embed it, rather
than every page on the site. The read carries a tag naming that component alone,
so a page that never used it is left alone.

A site running several deployments against different databases no longer risks
one of them serving another's components from a shared cache. A page embedding
more components than a cache can track is now read in several queries, so every
component still updates the pages that use it. And a component reference that
is blank rather than missing no longer takes the whole page down.

Three more corrections at the same step. A site that raises its block limit
through its style settings now loads components for the whole page rather than
the first part of it. A site that supplies components itself is held to the same
per-page read allowance as one that does not. And a component that cannot be
found is looked for once rather than once per place it is referenced from,
which stops a page spending its allowance on the same absent component and
losing a later one that is really there.
