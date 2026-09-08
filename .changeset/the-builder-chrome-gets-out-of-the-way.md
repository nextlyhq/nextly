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

The page builder's chrome now spends its width on the document rather than on
its own labels, and the page reads as a sheet.

The canvas declared no background, so it inherited the editor's frame — and a
block declares none of its own, so the grey showed through the document. What
an author composed looked nothing like what a visitor loads, which is the one
thing the canvas exists to show. It now carries the page surface, a border and
room around it. The border rather than tone alone, because which surface is
lighter INVERTS between modes: the page is 98.84 against a 96.52 frame in light
and 0 against 10.68 in dark, so a separation carried on the surfaces would need
tuning twice and checking twice, while one border token sits outside both on
either side of that inversion.

Everything that makes the sheet is stated on the PAGE rather than on the region
around it, so several side by side — one per breakpoint — would each carry
their own edge with nothing to revisit.

Exit, the breakpoint manager and the tier tabs are glyphs now. Together they
were spending about 170px of a bar whose job is to get out of the way, and
every one of them kept its accessible name and gained a tooltip.

A tier's glyph is chosen by the WIDTH it applies at, never by its label. A tier
is named by the site — "Tablet" on one, "Kiosk" or "Watch" on another — so a
lookup keyed by name answers for the words somebody happened to use and has
nothing to say for every site that chose differently.

The SELECTED tier keeps its word. The width readout beside these tabs is
deliberately empty while the selection already names the applying tier, so
icon-only throughout would take the name off the screen entirely in the
commonest state; two tiers can also share a glyph, and identical pictures would
then be the only thing telling them apart.

Zoom gained the stepper that its own model already supported: `steppedZoom` was
exported with no caller, so stepping was reachable from a host and not from the
editor. Each direction disables where the step list ends, so a button that
cannot move says so rather than depressing and changing nothing.
