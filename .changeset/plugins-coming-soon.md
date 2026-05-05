---
"@revnixhq/admin": minor
---

Add a prominent "Plugins are in development" banner (`<Alert variant="info">`) at the top of `/admin/plugins` and `/admin/plugins/[slug]` so users know plugin installation/management is a preview. Hide the Plugins entry in the main sidebar when no plugins are installed (driven by `branding.plugins.length`). Also marks the plugins section of the Nextly docs as in-development. nextly-site updates are deferred to a separate task.
