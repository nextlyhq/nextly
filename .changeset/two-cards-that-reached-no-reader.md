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

Two finished dashboard surfaces reached no reader, and both are now cards on the
widget grid.

`system:releases` shipped as a registered, access-controlled widget source with
no widget naming it, so nothing on any dashboard could ask it anything. It now
backs `core/upcoming-releases`, a list of what is scheduled and not yet shipped,
soonest first. It is the one core card carrying a `requiredPermission`, because
`ReleasesService.find` authorizes by throwing: an ungranted reader would get a
card stuck in its error state rather than an empty one, so the card is hidden
from them instead — and its placement is kept in the stored layout, so widening
someone's grant brings the card back where it was.

The recent-activity feed had an endpoint and a component and nothing rendering
it; the dashboard drew the welcome header and the grid alone. `RecentActivity`
is now `core/recent-activity`, which also makes it hideable and reorderable like
every other card. Two controls on it were removed rather than moved: a
"Detailed Log" link whose destination was the dashboard the card sits on, and a
"Sync Previous Events" button with no handler behind it. There is no audit-log
page for either to point at, and a dashboard feed showing a fixed handful of
rows with no in-widget pagination is what the products we compared against all
do. Its chrome now matches the cards beside it.

A core card names its body as a `core#` string in `nextly` and that string is
bound to a component in `@nextlyhq/admin`. The two packages do not depend on
each other, so nothing could notice one naming something the other never
registered — a card would quietly draw the unresolved placeholder. A test now
holds the two lists against each other.

A widget's `requiredPermission` now also accepts an ARRAY, meaning any-of. A
single slug could not describe the rule the services behind these cards apply:
`ReleasesService.authorize` treats `create` or `publish` as satisfying `read`,
deliberately, so a role granted only `create` can see the release it just made,
and the admin's `canViewReleases` capability lists all three. A card gated on
the read slug alone was a third encoding of that rule and the only one that
disagreed. Existing single-slug declarations are unchanged.

Two shipped list cards selected more fields than the `list` archetype draws. It
renders the first two and silently ignores the rest, so `core/recently-edited`
showed a collection beside an opaque document id and never the timestamp, on a
card whose description promises "newest first". Both now select two, and the
renderer declares how many it draws so a test can hold declarations to it.
