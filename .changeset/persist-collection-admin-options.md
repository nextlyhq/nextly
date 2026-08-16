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

fix(nextly): persist the admin options a collection is allowed to set

order and sidebarGroup were accepted by CollectionAdminOptions and dropped by the
projection that writes the registry, so a code-first collection could set its
sidebar position, type-check, and still sort by the default. admin.description
had no column under admin at all; it now resolves to the collection's own
description, which is the field the admin already renders and the Schema Builder
already edits.

A compile-time assertion now requires every admin option to be either persisted
or listed with the reason it is not, so adding one forces the author to classify
it in the same change. That list is exactly what drifted twice before.
