---
"@revnixhq/nextly": minor
---

Expose `nextly.meta` as a first-class property on the Nextly instance — a small KV API for runtime flags, backed by the `nextly_meta` table. Mirrors the existing `nextly.users` / `nextly.permissions` / `nextly.media` pattern. Templates that need to persist runtime state (e.g. `seed.completedAt`, `seed.skippedAt` for the dashboard seed card) can now use `await nextly.meta.set(key, value)` and `await nextly.meta.get<T>(key)` directly.

Also fixes a bug in the blog template where the seed POST route and the `/admin/api/meta/seed-status` GET/PUT routes accessed a non-existent `nextly.container` property at runtime — the dashboard seed card never hid after a successful seed, and Skip / X buttons returned 500.
