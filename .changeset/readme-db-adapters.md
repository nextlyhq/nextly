---
"@revnixhq/adapter-drizzle": patch
"@revnixhq/adapter-postgres": patch
"@revnixhq/adapter-mysql": patch
"@revnixhq/adapter-sqlite": patch
---

Tight-archetype README rework for the database adapter family:

- Trimmed `adapter-drizzle` from 528 to 83 lines; deep architectural content moved to a custom-adapters docs page (separate task)
- Trimmed `adapter-postgres` from 312 to 94 lines
- Trimmed `adapter-mysql` from 334 to 101 lines, adds dialect-notes section explaining MySQL emulations
- Trimmed `adapter-sqlite` from 343 to 98 lines, adds the "local demos only" warning consistent with the docs site
- Renamed all `@nextly/*` references to `@revnixhq/*`
- Added "most users do not install this directly" callout to `adapter-drizzle`
- Replaced fictional `database: postgresAdapter(...)` config with the real env-driven pattern (`DB_DIALECT` + `DATABASE_URL`); programmatic `createXAdapter` factories documented as advanced-only
