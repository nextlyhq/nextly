---
"@revnixhq/admin": patch
---

Show JSON now works on the Singles edit page. The shared `ShowJSONDialog`
and underlying `useEntryJSON` hook gained an optional `scope: "collection"
| "single"` parameter. When `scope === "single"`, the dialog hits
`/api/singles/{slug}` via `singleApi.getDocument` instead of
`/api/collections/{slug}/entries/{id}` via `entryApi.findByID`. The
collection call sites are unchanged — `scope` defaults to `"collection"`.
SingleForm now passes `scope="single"` through `EntrySystemHeader`, which
re-enables the Show JSON dropdown item that PR 4b temporarily hid.
