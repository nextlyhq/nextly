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

The admin renders inside your app's document, so your global CSS is in the cascade with it. A rule such as `h2 { font-size: clamp(1.5rem, 4vw, 2.25rem) }` in a `globals.css` is unlayered, and an unlayered rule beats every rule in a cascade layer whatever their specificity, so it beat the admin's own stylesheet: on an app made from the blog template, every dashboard card title drew at 36px on its 20px line, clipped. The admin's stylesheet now ends with one unlayered rule, `all: revert-layer` on everything inside `.nextly-admin`, weighted to beat any selector made only of element names (`h2`, `body main p`, `button::before`) and nothing that names a class, an attribute, a pseudo-class or an id. Your element rules no longer reach the admin, while your class-based styling of a component you add to it still does. The Page Builder's canvas is the exception, on purpose: it draws your page inside the admin, so your element rules still reach it and it looks like the finished page. In an app without such rules nothing the admin draws changes.

`@nextlyhq/admin-css` adds the rule in `isolateAdminStylesheet` and exports `hasHostElementShield(css)`, which the admin's build uses to check the stylesheet it ships still carries it after minification.

The base and blog templates write their focus ring as `html body :where(:focus-visible)`, which weighs two element names. Their pages draw it as before, it still beats a reset such as `button { outline: none }` added later, and it no longer redraws the admin's focused controls with the site's ring and corner.

**An existing app made from the base or blog template:** in `src/app/globals.css`, change the focus-ring selector `*:focus-visible` to `html body :where(:focus-visible)`, keeping its declarations. The old selector weighs a pseudo-class, which outweighs the admin's rule, so until it changes every focused control in the admin is drawn with your site's ring instead of the admin's own. Your site's pages draw the same either way. Another rule of yours that puts a pseudo-class on a bare element, such as `a:hover`, reaches the admin the same way; writing it as `a:where(:hover)` keeps it off, provided nothing else on your site relies on its weight.
