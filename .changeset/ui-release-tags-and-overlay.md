---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

`@nextlyhq/ui`'s release tags now reach the published types. Every export in the
barrel carried `@public` or `@experimental`, and none of it survived the build:
the declaration bundler flattens each re-export into one `export { … }` clause
and drops the doc comment attached to the export statement, so an editor
hovering `badgeVariants` was told nothing about its stability. The tags live on
the declarations now, where the bundler keeps them, and 229 of them reach
`dist/index.d.ts` where there were none.

`toast` and `ToasterProps` are re-exported from `sonner`, so their declarations
are not ours to annotate; they stay tagged in the barrel only. `cn` and
`uiPreset`, which ship from their own subpaths, carry `@experimental` now as
`STABILITY.md` already classified them.

Twenty prop types were also promoted to `@public`, which is a widening rather
than a change of intent: `STABILITY.md` already guaranteed that a prop type
carries the same stability as its component, and every one of these belonged to
a public component while advertising `@experimental` — so the published type
withdrew what the component promised, and a plugin could not wrap `Tabs` or
`Dialog` without depending on something labelled unstable. The rule is now
enforced by a test rather than written down.

Modal scrims are a theme token. Six components wrote the backdrop inline as
`bg-black/80`, identical in light and dark and at four different strengths, so
it could be neither themed nor white-labelled and was invisible to every token
check the package has. `--nx-overlay` (with `--nx-overlay-soft` for a scrim over
content rather than the page, and `--nx-overlay-strong` for one a full-screen
state screen writes its message directly onto — a see-through scrim tops out
below AA over a white page even for pure white text) is defined for both modes
and used everywhere,
with `bg-overlay` / `bg-overlay-soft` utilities in the v4 theme AND in
`@nextlyhq/ui/tailwind-preset`, so the documented Tailwind v3 path generates
them too. Dialogs, sheets and the command palette now share one backdrop
strength rather than three.
