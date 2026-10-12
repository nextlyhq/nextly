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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

Three field-editor fixes:

The form builder's field list was keyed by the field's name, and the Field
Name input rewrites that name on every keystroke — so each character
unmounted the card being edited and focus fell out of the input, forcing the
author to click back in before every next character. Card keys are now minted
by the list and follow the field through a rename, so renaming a field keeps
its card, and the input's focus, in place.

The Schema Builder translated a Label into its auto-derived Name one
character at a time: every space, apostrophe, period or colon became its own
underscore, so a label of "phone no." named the field `phone_no_`. The
derivation now follows the formatting rule the builder's other name and slug
derivations already apply — a run of anything that is not a letter or a digit
collapses to one underscore, and nothing dangles at either end. The rule is
for labels only: a stored name the server already accepts passes through
every save untouched (its legal underscore runs and trailing underscore are
identity, not noise), a name minted under the previous rule still follows its
label, and renaming a form field keeps the card open through the empty
intermediate value of a clear-and-retype.

A Code field's content could overflow its box: field rows lay fields on
proportional grid tracks, and a bare `Nfr` track honors an item's
min-content — which a Code field makes as wide as its longest unwrapped
line, since CodeMirror draws its document with `white-space: pre`. Each row
item's automatic minimum is now zeroed, so tracks keep their proportional
width and a long line scrolls inside CodeMirror's own scroller instead of
widening the page.
