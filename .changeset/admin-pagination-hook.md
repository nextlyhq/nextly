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

Give every admin list one owner for its page state, and one source for its page-size policy.

Twelve list surfaces each held the same two `useState` calls plus their own `handlePageSizeChange` wrapper that set the size and then reset the page. They now use the existing `usePagination` hook, which owns those resets. That removes the drift risk across the copies and, more usefully, removes the wrapper entirely: `onPageSizeChange` is the hook's `setPageSize`, which resets the page in the same update, so a query keyed on both refetches once rather than twice.

The page-size options were a literal `[10, 25, 50]` written out at nine call sites. They are now `PAGINATION.TABLE_PAGE_SIZE_OPTIONS`, beside the existing page-size constants, so the policy can change in one place. The two lists that deliberately differ keep their own: the media grid offers 12/24/48/96 because it lays out thumbnails, and the delivery log offers 20/50/100 because it is read in long scans. `usePagination`'s own defaults now derive from those constants rather than restating 0 and 10.

`Pagination`'s `pageSizeOptions` is typed `readonly number[]`, since the component only maps over it and a mutable type would reject the shared options for no reason a caller could act on.

Two lists stay off the hook and say why where they declare their state. The entries list is 1-indexed because that is what its API takes, and converting at every read and write trades one clear boundary for a class of off-by-one. The relationship picker accumulates results rather than paginating them: its page number only increments, results append, and there is no way back to a previous page.
