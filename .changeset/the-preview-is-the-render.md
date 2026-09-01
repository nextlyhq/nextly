---
"@nextlyhq/admin": patch
"nextly": patch
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
