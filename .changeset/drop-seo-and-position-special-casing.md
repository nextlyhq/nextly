---
"@revnixhq/admin": patch
---

Refactor: the entry-form sidebar no longer renders user-defined fields. Two pieces of legacy special-casing were removed from EntryForm:

- Fields named `seo` (or any group whose name contained "seo") were previously pulled out of the main column and rendered in the sidebar. That match is gone — your `seo` component now renders inline like any other component.
- `admin.position: 'sidebar'` is no longer honored by the renderer. The Builder removed this knob during the prior redesign; this completes the symmetry by dropping the orphaned filter on the renderer side.

Sidebar now shows only system content (action buttons, slug, Document Info). Title and slug stay in their existing header card for now; the redesign moves them in a follow-up PR.
