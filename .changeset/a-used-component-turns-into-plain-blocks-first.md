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

Deleting a component that pages still use is getting closer: the page builder can now turn every copy of a component into the plain blocks it draws, on every page, working draft, language, Single, component and pattern, before the component goes. While that runs, a save that would add a new copy of the component is refused, judged against what the page stores at that moment; a page that already holds a copy can still be saved, and is converted again from what was saved. Each conversion writes only the blocks field and is checked against what was read, so an edit made in the meantime is converted rather than overwritten. A published page with unpublished changes has its draft converted and is reported, so its author can publish or discard them first. Pages whose blocks sit inside a repeater or a named group, and Layouts naming the component, are reported rather than changed. The deleting itself, and the dialog, come next.

The rewrite is generic: other changes to every page placing a component plug in a step `(stored value, form) => unchanged | rewritten | refuse`, and share the fence, the check and the progress. It is offered as the `componentDeleteRewrite` service, @experimental.

This adds two tables of the page builder's own (`page_builder__component_deletions` and `page_builder__component_deletion_hosts`). Run `nextly migrate` when upgrading a production site.
