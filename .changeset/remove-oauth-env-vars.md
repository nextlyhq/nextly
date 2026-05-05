---
"@revnixhq/nextly": patch
---

Remove unused OAuth env-var declarations (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`) from the runtime env schema. Nextly uses 100% custom auth (email + password, JWT, sessions, API keys, RBAC) — these vars were never read anywhere. Removing them prevents the schema from suggesting unsupported configuration.
