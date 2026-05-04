---
"@revnixhq/nextly": minor
"@revnixhq/admin": minor
---

Discoverable demo-content seeding via the admin dashboard.

After scaffolding a non-blank template (e.g. blog) and finishing /admin/setup, a new "Seed demo content" card appears at the top of the admin dashboard. Click "Seed demo content" to populate the project with sample posts, authors, categories, tags, a homepage, and a newsletter form. Click Skip (or the X) to dismiss it forever.

Works for both code-first and visual schema builder approaches. The seed function now runs in three phases:

- **Phase A (visual approach only):** programmatically registers the template's collections, singles, and user-extension fields via the visual schema builder's runtime API.
- **Phase B:** syncs CRUD permission rows for any newly-registered resources and wires them to the super-admin role.
- **Phase C:** populates content (media, roles, users, taxonomies, posts, singles, newsletter form) with per-entity idempotent upserts so re-runs are safe.

Seeded/skipped state is persisted in a new `nextly_meta` key/value table so the card stays hidden across browsers and team members. The previous /welcome page (the only place the seed button used to live) has been removed; the dashboard card calls the same /admin/api/seed endpoint.
