---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

**FAQ markup is now added only where someone chose it.** The SEO plugin emits `FAQPage` structured data only on a page whose structured data type is "Questions and answers", chosen for its content type, for the page or by its route's `structuredDataHints.type`. Before, any page of another type whose route passed `structuredDataHints.questions`, or whose `faq`, `faqs` or `questions` field held questions, also got an `FAQPage` beside its own markup. **Sites that got FAQ markup this way lose it on those pages after upgrading.** Google stopped showing FAQ rich results in May 2026, so search listings do not change; a site that still wants the markup on a page sets that page's type, or its content type's, to "Questions and answers". The type choosers now say beside "Questions and answers" that Google no longer shows these results.
