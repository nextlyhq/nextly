---
"nextly": patch
"@nextlyhq/admin": patch
"@nextlyhq/plugin-form-builder": patch
---

Remove the hardcoded default super-admin credentials from `seedSuperAdmin()`. The seeder no longer falls back to a built-in email/password pair: callers (the `/admin/setup` wizard and the dev seed) must pass an explicit `email` and `password`, and the function throws a `VALIDATION_ERROR` if either is missing. `seedAll()` likewise fails closed when super-admin seeding is enabled but no credentials are supplied, instead of creating a known-weak default account. This removes a well-known default credential from shipped framework source.

Also hides the placeholder address the admin user menu previously showed when a user had no email (the line is now omitted when empty), and standardizes example email placeholders across the admin and form-builder UIs onto the `nextly.local` domain.
