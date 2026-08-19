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

Two new checks close the same gap from opposite sides. `@nextlyhq/no-token-alpha-suffix` rejects an alpha suffix appended to a design token — `\`\${color}20\``produces`var(--nx-primary)20`, which is not valid CSS, so the browser drops the declaration and the element renders with nothing where the tint belonged. It was correct while colours were hex and fails silently now that they are tokens, which is why it survives review. The design-lint guard gains the same rule for stylesheets, plus a named-colour check: `color: rebeccapurple`is as fixed as`#663399`, and a token DEFINED as a named colour quietly ends the aliasing that a whole namespace's contrast depends on.

The guard also now reads `packages/builder/src`, the editor's entire interface and previously the largest first-party UI surface no design check covered. Its `--nx-builder-*` namespace stays; these rules never cared which namespace a token belongs to, only whether a colour was written down instead of referenced.
