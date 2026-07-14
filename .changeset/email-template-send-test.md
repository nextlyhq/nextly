---
"@nextlyhq/admin": patch
---

Add a Send test action to the email template editor. In edit mode, a "Send test" button in the top bar opens a dialog to send the template to a chosen address using the current sample data (reusing the existing send-with-template endpoint). It sends the saved template, so unsaved editor changes are noted as not included, and the result is surfaced as a toast.
