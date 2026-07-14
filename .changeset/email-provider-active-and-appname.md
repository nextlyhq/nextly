---
"@nextlyhq/admin": patch
"nextly": patch
---

Add an Active toggle to the email provider form so a provider can be paused without deleting it (previously only the API could deactivate one). Also make the application name injected into emails as `{{appName}}` configurable via `email.appName` in `defineConfig`, instead of being hardcoded to "Nextly" (the default is unchanged).
