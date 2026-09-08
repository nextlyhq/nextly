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

Content can now be scheduled to publish, and it goes live at the moment you
chose rather than the next time something happens to run.

Group the pages, posts and settings that belong to one launch into a release,
give it a date and time, and everything in it becomes visible together. Removing
content works the same way — schedule the takedown and it stops being visible on
the hour you picked.

The part that is easy to get wrong, and the reason this took the shape it did:
a release changes what a _reader_ sees, not just what the database stores. So a
post that is still a draft, but whose release has come due, is returned by an
ordinary visitor's request — including when it is reached indirectly, as the
author of a post rather than by name. Content that is published when you ask for
it directly and missing when you arrive at it through a link is worse than
content that is late.

That applies to one-off documents too — a homepage, a settings page — which are
loaded and refused rather than filtered, and so needed the same answer reached a
different way.

While nothing is scheduled, none of this costs anything: the check is a single
cached comparison, and no extra query is made on a site that has never created
a release.
