---
"@revnixhq/admin": patch
"@revnixhq/nextly": patch
---

Fix: clicking the Collections / Singles / Plugins icons in the admin sidebar no longer auto-navigates to an arbitrary "first" collection (which often landed on /admin/collection/posts regardless of which collection the user just created in the Builder). The icons now open the sub-sidebar so the user can pick the specific collection / single they want.

Also: the collections list API now honors the documented `sortBy=name` query parameter (previously silently ignored, causing collections to be returned in created-at order instead of alphabetical). The "name" sort is treated as an alias for "slug" since both refer to the collection's stable identifier.
