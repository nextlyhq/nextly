---
"@revnixhq/nextly": patch
"@revnixhq/create-nextly-app": patch
---

Heavy-archetype README rework for `@revnixhq/nextly` and `@revnixhq/create-nextly-app`, plus follow-up API fix to the root README:

- Aligned both package READMEs with the canonical alpha banner, "Why Nextly?" feature grid, and hero visual slot
- Added the Hamin Lee story footer to `@revnixhq/nextly` (npm-name transfer credit)
- Added the telemetry block to `@revnixhq/create-nextly-app`
- Fixed CLI flags table to match current implementation: removed `--demo-data`, removed the `both` schema-approach option
- Replaced the fictional `database: postgresAdapter(...)` config in the root README's tiny example with the real env-driven pattern (`DATABASE_URL` + optional `DB_DIALECT`)
- Fixed field-helper signatures in code examples (`text({ name, ... })`, `relationship({ name, relationTo })`, etc.) to match the actual API exported by `@revnixhq/nextly/config`
- Stripped em dashes throughout
