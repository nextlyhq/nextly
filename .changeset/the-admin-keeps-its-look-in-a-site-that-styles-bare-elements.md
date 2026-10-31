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

The admin keeps its own look in a site whose stylesheet styles bare elements.

The admin renders inside your app's document, so your global CSS is in the cascade with it. A rule such as `h2 { font-size: clamp(1.5rem, 4vw, 2.25rem) }` in a `globals.css` is unlayered, and an unlayered rule beats every rule in a cascade layer whatever their specificity, so it beat the admin's own stylesheet: on an app made from the blog template, every dashboard card title drew at 36px on its 20px line, clipped. The admin's stylesheet now ends with one unlayered rule, `all: revert-layer` on everything inside `.nextly-admin`, weighted to beat any selector made only of element names (`h2`, `body main p`, `button::before`) and nothing that names a class, an attribute, a pseudo-class or an id. Your element rules no longer reach the admin, while your class-based styling of a component you add to it still does. In an app without such rules nothing the admin draws changes.

`@nextlyhq/admin-css` adds the rule in `isolateAdminStylesheet` and exports `hasHostElementShield(css)`, which the admin's build uses to check the stylesheet it ships still carries it after minification.

The base and blog templates write their `*:focus-visible` ring as `html body :where(:focus-visible)`, which weighs two element names. Their pages draw it as before, it still beats a reset such as `button { outline: none }` added later, and it no longer redraws the admin's focused controls with the site's ring and corner.
