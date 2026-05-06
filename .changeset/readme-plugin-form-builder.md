---
"@revnixhq/plugin-form-builder": patch
---

Tight-archetype README rework for `@revnixhq/plugin-form-builder`:

- Renamed `@nextlyhq/plugin-form-builder` to `@revnixhq/plugin-form-builder` to match published scope
- Added "What this plugin adds" sub-section listing admin routes, collections, field types, and lifecycle states (per spec §7.1 Family E)
- Documented both the default `formBuilderPlugin` instance and the `formBuilder` factory for customization
- Added admin-styling import block matching real wiring in `apps/playground/src/app/admin/[[...params]]/page.tsx`
- Aligned alpha banner wording with spec
