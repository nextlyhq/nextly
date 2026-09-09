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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Form submissions are transformed, sanitized and validated on a `beforeChange` hook on the submissions collection, the last collection-level mutating phase before the insert, so every path that writes one gets the same treatment: the built-in `POST /api/forms/:slug/submit`, `nextly.forms.submit()`, a host route calling `submitForm`, the admin, an update that replaces a stored payload, and an update that moves a submission to a different form, whose stored payload has to satisfy the schema it lands on. Those paths previously stored whatever the caller sent, because core skips `json` fields when it sanitizes: undeclared keys, values that never met the form schema, and markup intact.

Sanitizing now runs before validation, so a rule judges the value that will actually be stored. `<b></b>` no longer satisfies a required field and then reduces to an empty string.

Stripping markup no longer removes text that only looks like a tag. A `<` opens a tag only when what follows could name one, which is the HTML tokenizer's own rule, so an answer containing `2 < 3` survives intact. Stripping is a single pass that keeps one invariant: a `<` it kept is never followed by a character that would open a tag. Removing a tag can put its neighbours together into another one, and rescanning until the text stopped changing held the same invariant at quadratic cost, which an unauthenticated caller could spend the server's CPU on.

`validateSubmission` asks the same rule rather than restating it, so a preflight check and the write can no longer disagree about the same submission.

A submission flagged as spam is stored without being validated so a false positive stays reviewable, and that exception now belongs to a row rather than to a call: it travels as a symbol key on the row itself, which a request body cannot carry and a second write cannot take. Marking a row "Not spam" checks the payload it carries against the form.

Moving a submission to another form re-projects its answers onto that form's fields, and that change is stamped as an edit, because the visitor's stored answers changed and nothing else records it.

A parent-form read that fails is no longer reported as a validation error. Only a form that is not there is; a pool timeout or a throwing hook propagates, so a server fault stops arriving as the writer's mistake.

Spam protection stays on `submitForm`, where a honeypot and a rate limit are facts about a request rather than about a row. The built-in submit route does not reach it, and the guide now says so.
