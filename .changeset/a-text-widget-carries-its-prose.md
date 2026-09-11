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

A `text` widget declares its prose and the dashboard draws it.

The archetype existed in the contract with nothing to carry the prose and no
renderer behind it: a plugin declaring one got a card reading "not rendered
yet". A text widget now declares `content` as markdown -- headings, paragraphs,
lists, emphasis, inline code, block quotes and links -- and the host draws it
through the same rich-text stack the editor uses, read-only, loaded only when a
text card is on the dashboard.

Three things the markdown cannot do, by design. Raw HTML is shown as the text it
is. A link may point at `http`, `https`, `mailto`, `tel`, or a path on this site
written as `/...`, `./...` or `#...`; one to anything else is left on screen as
the markdown it was written in, so the author can see it was refused. And the
content is bounded at registration, and refused over the bound rather than cut:
it travels inside every dashboard load for every reader offered the card. An
external link opens in a new tab.

`content` is required for `text` and refused on every other archetype, on both
the registry and the plugin channel through one rule.

The admin workspace payload now carries only the widget declarations its reader
may see, and only the parts of them. A declaration is its whole content -- a
`text` widget's prose, an `actions` widget's shortcuts -- so the gate a widget
declares through `requiredPermission`, and the gate each of its actions
declares, is applied on the server before the declaration ships, from the
plugin channel and the registry alike, by the same decision the dashboard
layout endpoint places cards with. Where two plugins contribute the same widget
id, only the first declaration ships, which is the one the dashboard draws.
Previously every authenticated caller received every declaration whole and the
browser hid the gated cards and shortcuts.
