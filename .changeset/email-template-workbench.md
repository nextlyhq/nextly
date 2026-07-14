---
"@nextlyhq/admin": patch
---

Redesign the email template create/edit page as a focused, full-width authoring workbench instead of a stack of settings cards. The page now has a top bar (back, inline template name, slug, active status, and Save), a collapsible left rail with Variables / Data / Settings tabs, a center pane with the subject line and a full-height HTML/plain-text code editor, and a live preview pane that renders the email (composed with the shared layout) with device (desktop/mobile), client theme (light/dark), and format (HTML/plain-text) toggles. Variables can be inserted into the editor at the cursor, sample data drives the preview and is seeded from the template's declared variables, and variables referenced but not declared or sampled are flagged. The built-in variable reference now lists the variables that are actually injected. No change to the saved template shape or the send pipeline.
