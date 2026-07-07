---
"@nextlyhq/plugin-page-builder": patch
---

Fix installation of the plugin in fresh apps: internal `@nextlyhq/*` peer dependencies now use the `workspace:*` protocol, so each published version's peers are rewritten to the versions released alongside it instead of a hard-coded (and stale) pin. Previously `npm install @nextlyhq/plugin-page-builder` / `nextly add` failed with `ERESOLVE` because the published peers demanded an older core version than the one installed.
