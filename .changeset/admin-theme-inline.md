---
"@nextlyhq/admin": patch
---

Modernize the admin design tokens to Tailwind v4's `@theme inline` model. The color tokens are now mapped with `@theme inline`, which removes a legacy duplicate-mapping workaround (previously the color variables were declared three times to make scoped/dark overrides resolve). Tokens are now cleanly runtime-overridable for theming, and the compiled CSS is smaller. No visual or API change.
