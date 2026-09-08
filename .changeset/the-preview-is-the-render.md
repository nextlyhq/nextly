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

The email template preview now shows what recipients receive.

The editor interpolated `{{variables}}` in the browser, which was a second
implementation of a render the server already performs — and the two had
drifted. The preview omitted the preheader entirely, and reported an empty
plain-text part for every template that does not author one, when the send path
derives that text from the body and delivers it. Both were invisible: a preview
that leaves something out looks correct.

The editor now renders through `POST /api/email-templates/preview`, which
composes a draft with the same function the transport uses, so the two cannot
disagree. The browser-side copy is deleted rather than kept in sync.

Also fixed in the renderer itself: a layout row rendering ITSELF resolved
`{{appName}}` and `{{year}}` against nothing and emitted `<footer> </footer>`.
Those values were supplied only to a wrapper that a body was spliced into, but
it is the same markup either way. An explicit value from the caller still wins.

The preview frame now draws at the 600px width HTML email is authored against
rather than 640, and scales to fit the pane instead of reflowing the email to a
width no recipient uses — with the real width and the scale shown, so a frame
drawn smaller is never mistaken for one at true size.
