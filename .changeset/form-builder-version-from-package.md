---
"@nextlyhq/plugin-form-builder": patch
---

The plugin now reports its version by reading `package.json` at load time instead of a hardcoded string, so the version shown in the admin (and returned by `definePlugin`) can no longer drift from the published package version.
