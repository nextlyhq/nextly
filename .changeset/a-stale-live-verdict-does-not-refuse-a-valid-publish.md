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
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A publish is no longer refused over a field whose rule the pending change itself satisfies.

The gate consults the live row as well as the promoted document, because a rule is never asked about a key that is absent and a field the pending change removes outright would otherwise be judged nowhere. It took the live row's verdict for every field, though, and a rule reads its siblings: where the live row says `kind: "private"`, which denies `guarded`, and the pending change sets `kind` to `public` and edits `guarded` legitimately, the stale verdict refused a publish that is perfectly valid. The live row now speaks only for the fields the promotion no longer carries.

A field declared inside a group or a repeater counts as content too. The names the promotion gate defers to were collected with `addressableFields`, which pushes a named field and stops, so the set held the top level and nothing else and a nested field named like one of the store's own columns was still skipped. The walk that collects them descends every container now, and a Single's publish hands its declared names over as a collection's does.

A deletion inside a container a rule denies whole is judged. The live row's denial names the container, and the promotion can keep that container while dropping a protected child from inside it: asked at the container, "does the promotion still carry `seo`" is yes, and the dropped `seo.secret` went through unjudged. Each live-side denial is expanded to its leaves before it is compared.

A publish that also edits a group, repeater or JSON field no longer fails validation. The ordinary write encodes those fields to their column strings before the promotion runs, and the check on the promoted document then read a group as text and refused it as "must be an object", so an editor who published their pending change together with any edit to such a field could not publish at all. Both promotion checks now read the document in its logical shape, through the same conversion that reads the live row, and the write encodes it once.

Whether the caller supplied a value is read from what they sent. It was read from their payload after the field rules had already removed what they may not write, and after that payload's containers had been encoded, so a protected value the caller sent unchanged inside a group looked unsent and the publish was refused as a deletion they never made.
