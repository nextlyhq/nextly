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

The admin's published stylesheet no longer reacts to a host app's own dark
class. The admin mounts inside the host's document, and every `dark:`,
`group-*:` and `peer-*:` utility in its prebuilt sheet compiled to a reference
to an ancestor class the rule does not own — so a host doing class-based dark
mode (`next-themes` with `attribute="class"`, or Tailwind's class strategy)
activated every dark utility inside the admin while the admin's own tokens
stayed light, painting dark borders and text onto light surfaces. Those
references are now rewritten to sit under `.nextly-admin`, so the admin
renders in whatever theme its own user picked, and its own dark mode keeps
working from the admin root as before. Hosts have nothing to do.

The build now refuses to ship a sheet that leaks this way: the release CSS
build fails, naming the offending selectors, and the dev build reports them.
`@nextlyhq/admin-css` exports the check (`findUnconfinedVariants`) beside the
`confineVariantClasses` pass that satisfies it.
