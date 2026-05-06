---
"@revnixhq/admin": patch
"@revnixhq/client": patch
"@revnixhq/ui": patch
---

Tight-archetype README rework for the consumer-extension family:

- Renamed all `@nextly/*` references to `@revnixhq/*` to match the published scope
- Aligned admin / ui READMEs with the canonical alpha banner and tight anatomy
- Replaced fictional `app/admin/[[...params]]/page.tsx` integration in `admin` README with the real `<RootLayout />` pattern verified against `apps/playground/src/app/admin/[[...params]]/page.tsx`
- Updated `ui` README with the actual 33-component categorized list and the Tailwind-preset setup snippet
- Kept `client` honestly marked as a placeholder (every method currently throws `Not implemented`); README now points readers at the REST API and Direct API as the workable alternatives until the SDK ships
