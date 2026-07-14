---
"nextly": patch
"@nextlyhq/admin": patch
---

Consolidate email templates and layouts into one kind-tagged model. Layouts are now first-class rows (`kind: "layout"`) whose HTML holds a `{{content}}` placeholder where the body is injected, replacing the two reserved `_email-header`/`_email-footer` rows and the separate Email Layout page. Legacy rows migrate into the default layout automatically on boot. Templates gain `preheader`, per-template `from`/`replyTo`, and a `layoutId` selector; the send path delivers these and composes via the layout placeholder. The bespoke `getLayout`/`updateLayout` service methods, REST endpoint, and Direct API methods are removed — layouts are edited through the ordinary template CRUD surface.
