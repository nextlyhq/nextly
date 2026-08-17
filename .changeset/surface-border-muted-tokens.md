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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(blocks-engine): add color.surface, color.border and color.muted to the guaranteed token set

The guaranteed set had no surface colour and no border colour, and their absence
made four blocks compromise: `core/card` shipped with no background and no
border, `badge` was unbuildable because a tinted background IS the block, the
accordion had no divider and the table no border colour.

It also created a defect class. Because nothing in the set could express a
surface, six blocks across three lanes independently reached for `--nx-*` — the
ADMIN namespace, which no published page emits, so those rules validated,
compiled, shipped and resolved to nothing. That is design pressure rather than
six mistakes: when the correct mechanism is missing, whatever resembles it gets
used.

All three define both light and dark values, and a test now requires that of
every colour token rather than only the new ones — a colour defined only for
light silently keeps its light value on a dark page. `color.muted` was chosen to
clear WCAG AA against `color.background` in both modes rather than by eye,
because a muted token that fails contrast is worse than none: it reads as
sanctioned.

One border colour rather than a subtle/strong scale. A scale is much harder to
remove from a guaranteed set than to add to one, and no block has asked for the
distinction; a site wanting more defines its own, and `resolveSiteTokens` layers
additions by name.
