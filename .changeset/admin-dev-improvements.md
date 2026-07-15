---
"@nextlyhq/ui": patch
"@nextlyhq/admin": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-form-builder": patch
---

Isolate the admin design system from the host site, and fix admin surface consistency.

The admin's design tokens are now namespaced (`--primary` is now `--nx-primary`, `--background` is now `--nx-background`, and so on) and the admin's scoping wrapper is now `.nextly-admin` (was `.adminapp`). Utility classes are unchanged: `bg-primary`, `text-muted-foreground` and friends keep working exactly as before. This means a site's own `--primary`/`--background` tokens can no longer collide with the admin's, and the admin can no longer restyle the site around it.

Also fixed: the admin's CSS reset (`html`/`:host` font and line-height, file-input and form-element rules) leaked onto the host page instead of staying inside the admin; `dark:` utility variants were silently corrupted during CSS scoping and now work; a stray selector gave focused inputs the browser-autofill treatment; and the dark-mode sidebar now shares one flat surface with the content instead of appearing as a lighter panel.

If you wrote custom CSS targeting admin internals, reference the `--nx-*` token names and the `.nextly-admin` wrapper.
