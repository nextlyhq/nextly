---
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-sdk": patch
---

Add a `default` export condition to every entry in the package `exports` map so these packages resolve under CommonJS/`require`-based tooling (for example `tsx`-run scripts and Node's CJS loader), not only under ESM `import`. Previously each subpath declared `types` and `import` only, so a CJS resolver could not find a main entry and failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. This matches the export shape already used by `@nextlyhq/plugin-page-builder`.
