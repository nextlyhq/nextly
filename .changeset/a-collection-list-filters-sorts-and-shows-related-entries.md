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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
"create-nextly-app": patch
"nextly": patch
---

A collection list can now filter, sort and window its entries, and show a related list. Filter rows (is, is not, more or less than, contains, any of, none of, has a value) narrow the entries, several sort keys order them with empty values last and ties in a stable order, and a limit of 1 to 100 and an offset skip and cut them. A list can show a to-many relation of the page's entry or of the outer list's item, in the order the relation stores them unless a sort is set; a sorted relation of more than 100 entries is read in parts and kept in the database's order. A date filter compares whole days in the site's time zone, inside a component too. When nothing matches, or the read fails, the list draws its own empty state, and an author previewing a draft is told why. Saving refuses an out-of-range limit or offset, a filter or sort on a field the collection lacks or visitors cannot see, a filter on a field holding several values, a filter whose operator or value its field's kind does not take (an order on text, a day on a number), and a related list nested more than one level deep. The page actions API gains `set-list-query`, judged by the same checks. A list stored before this renders as it did; one whose sort names a removed or hidden field lists in id order. In the Page Builder, the block is now named Collection list (its stored type stays `core/collection-loop`, so saved pages are unchanged), and its Content tab edits all of this: Source (a collection, or the page entry's or each outer item's related entries), Filters as one sentence per row that opens into its field, operator and value, Sort rows with a drag handle, Alt+↑ and Alt+↓ and each direction in words (Newest first, A–Z, Highest first), Number of items and Skip the first, and Canvas shows: Entries or When empty. Under Number of items the selected list says how many entries match and how many show ("4 entries match, so 3 show."), taken from the list's own read on the canvas. Only fields visitors can see are offered. The canvas draws each list with the entries a visitor would see, in the language being edited and within a published page's read allowance, tags a list showing its empty state, and says when its sort fell back or its read failed; a fallen-back sort's note has a Choose a field button that takes the author to the sort. A save's refusal names the collection as authors read it ("which Posts doesn't have"). Layers shows a list's Each entry and When empty regions.
