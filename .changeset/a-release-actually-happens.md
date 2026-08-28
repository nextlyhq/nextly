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

Scheduled content releases are now performed, not just anticipated.

A due release previously changed only what a reader saw. Nothing wrote the
change down, so cancelling a release that had already "gone live" silently
reverted the content, and nothing outside a live database read ever saw it at
all. A release now materialises: each document is published or withdrawn
through the ORDINARY content mutation, as the author of the member that
scheduled it.

Running it as that person rather than as a trusted system principal is the
point. A release is somebody's decision to publish something later, and the
write that carries it out is theirs — anything else would let a scheduled
publish reach content its author could not have published by hand. A member
whose author was never recorded, or whose account has since been deleted or
deactivated, is refused rather than run as anybody else, and its release stays
scheduled so the next pass retries instead of the work disappearing from both
the content and the schedule.

Public pages also expire when a release is due. A cached route previously had
two ways to go stale — a tag someone busts, or a fixed number of seconds — and
neither fits a scheduled publish: tags do nothing until something runs, so a
page cached before the due instant could serve pre-release content
indefinitely, and a fixed window is a guess unrelated to when anything changes.
The cache lifetime is now derived from the schedule itself, so a page whose
content has a release due in three hours may be cached for three hours and no
longer.

Three permissions are seeded — reading content releases, creating them, and
publishing them. Scheduling is deliberately separate from creating: assembling
a release changes nothing a reader can see, while scheduling one is what puts
content live later.

The permission resource is named `content-releases`, not `releases`. Registering
a resource reserves its name against collections and Singles, and "releases" is
a word real sites use for content — a press-releases collection is among the
most common on a corporate site. Reserving it would have failed an existing
install at boot and quietly cost preset roles their access to a Schema-Builder
collection of that name.

Also fixes the content client handed to a background job, which called the
Direct API through an extracted method reference. That works against the
module-level facade and fails against a booted instance, which reaches its
context through `this`.
