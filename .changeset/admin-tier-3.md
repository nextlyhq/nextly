---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fix dates reading back empty on SQLite, correct the total reported beside a list, highlight code everywhere it appears, and rebuild the API Playground around the request you are actually sending.

**Dates on collection entries read back `null` on SQLite, and now don't.** `createdAt`, `updatedAt` and every date field you defined came back empty from the API and rendered as `–` in the admin's Created and Updated columns. Entries are saved inside a transaction, and on that path a date was written as text into a column the reader treats as a number, so nothing failed on save and everything failed on read. Sorting or filtering by a date silently did the wrong thing rather than nothing, because the two encodings do not compare. **Postgres and MySQL were never affected, and neither were Singles or media.** Existing databases are repaired once, automatically, on the next start — you do not need to run anything, and the entries whose dates came back empty will have their real dates again. If you have been working around this by not trusting `createdAt` on SQLite, you can stop.

**The total beside a list disagreed with the list.** A collection of 5 entries reported `total: 4` when one was a draft, and asking for drafts returned rows with a total of `0`. The count was answering as an anonymous reader while the rows were fetched as you, so it left out everything you could see and a public visitor could not. `totalPages` is derived from that total, so anything paging on it could not reach the last page of its own results — a table could hide entries that were plainly there. Counts now match the rows beside them.

**Code is highlighted wherever it appears, in both themes.** Code blocks in the rich-text editor were never highlighted at all, the email template editor's dark mode had never worked, and both code editors stayed light when the admin was dark on a dark OS. The frontend rendered code with no highlighting and a colour baked into the markup that your stylesheet could not override. Highlighting now comes from the design tokens, so it follows the active theme, and the HTML sent to your site describes what each token _is_ and leaves the colour to your CSS. The same applies to highlighted (marked) text: it no longer carries a fixed yellow that a dark page could neither restyle nor read.

**The API Playground now builds a request instead of asking you to remember one.** The method, URL, and Send sit on one pinned line (`⌘↵` to send, `Esc` to cancel), so a long list of parameters no longer pushes them off-screen. Sort is a field picker with a direction toggle rather than free text you had to prefix with `-`; the fields you can return are checkboxes rather than hand-written JSON; depth, limit and page are number inputs carrying the bounds the server enforces. A Code tab shows the same request as cURL, `fetch`, or Nextly SDK — the SDK one runs on a server with no HTTP round trip. The response pane reports size and headers alongside status and latency, and the body downloads exactly as it arrived. Every parameter's explanation now sits under the field it explains instead of behind a hover, where a keyboard or screen reader could not reach it at all.

**Tooltips appear where you point.** Any tooltip inside the admin's main content could land hundreds of pixels away — under the sidebar — because the positioner and the browser disagreed about what a CSS container is. This affected the collapsed sidebar, the rich-text toolbar, table row actions, and every field help icon.

**Status colours are now one vocabulary.** Success, warning and destructive each derive their whole range from a single token, so retheming one moves every shade with it and they cannot drift apart. Two different greens meant "success" and two different reds meant "destructive" before this. Along the way a document icon was rendered in the red used for destructive actions, "Advanced Fields" was marked with the same red, and category dots were coloured by hashing the category name — a colour that meant nothing and changed if you renamed it. Those are now neutral, and the design guard rejects raw palette classes so they cannot come back.

Also: the email template editor gained line numbers and code folding, the request body field is a JSON editor rather than a plain textarea, and `nextly` no longer ships seven editor packages it never loaded.
