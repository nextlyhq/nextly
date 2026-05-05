---
"@revnixhq/admin": patch
---

Text and Textarea fields now enforce `validation.pattern` (regex) on the client. Previously the Builder could attach a pattern string and a custom error message but the renderer ignored both — submissions only got server-side validation. Pattern is compiled with `new RegExp()` at schema-build time; malformed patterns are dropped with a dev warning instead of crashing the form.
