---
"@revnixhq/create-nextly-app": patch
---

Refresh template READMEs for alpha:

- Refreshed `templates/README.md` with cross-links to per-template stubs and dropped references to the removed `both` schema approach
- Added stub `templates/base/README.md` (not user-selectable; explains its role and adds maintainer-test commands)
- Added stub `templates/blank/README.md` (when to pick it, scaffold command, link to blog example)
- Refreshed `templates/blog/README.md` with the alpha banner, dropped references to the removed `both` schema approach (`both.config.ts`), and corrected the `getNextly()` example to pass `{ config: nextlyConfig }` (matches real `submit-newsletter.ts` usage)
