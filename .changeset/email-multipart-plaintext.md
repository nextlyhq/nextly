---
"nextly": patch
---

Send emails as `multipart/alternative` with a plain-text alternative instead of HTML-only. The plain-text part uses a template's authored `plainTextContent` when present, and is otherwise derived from the HTML by a new `htmlToText` helper (keeps link targets, turns block elements into line breaks, decodes common entities). The provider adapter interface gains an optional `text` field, forwarded by the built-in SMTP, Resend, and SendLayer adapters; custom adapters are unaffected because the field is optional. Sends through a database template also now log a warning when a required declared variable is missing (they still send, so existing flows are not broken). Adds unit tests for the template engine, including the new plain-text conversion.
