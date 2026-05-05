---
"@revnixhq/nextly": patch
"@revnixhq/admin": patch
---

Round-2 fixes for the seeded blog experience:

- **SQLite migration** for `user_field_definitions` / `email_providers` / `email_templates` (postgres has had this since 0009 and mysql since 0005, but SQLite was missing it). Without these tables, code-defined user fields (`bio`, `avatarUrl`, `slug` in the blog template) silently fail to register, the `user_ext` table never gets created, and `/authors/[slug]` resolves to `/authors/undefined`. The new migration unblocks the cascade.
- **Admin reroutes user-relationship edit/create to dedicated pages.** When clicking an author from a post detail (or the "Create new user" button on a relationship field), the admin previously hit `/admin/api/collections/users` (a dynamic-collection endpoint that 404s for the core `users` collection). It now navigates to `/admin/users/edit/[id]` / `/admin/users/create` directly.
- **Featured Image thumbnail fallback.** The thumbnail preview in the entry form now serves the full URL for SVG uploads (Nextly's media pipeline sometimes leaves `thumbnailUrl` null for them), and falls back to the full URL via an `onError` handler when a thumbnail fails to load.
- **Date formatting helper for the blog template.** `formatPublishedDate()` returns `null` for missing or unparseable dates so the `<time>` element is skipped instead of rendering literal `Invalid Date`.
