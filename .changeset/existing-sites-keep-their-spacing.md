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

Existing sites keep their spacing. A site's spacing is now a choice, **Space between blocks** under **Design → Variables**: **From each block's margins (classic)**, the spacing every page had before blocks took their spacing from their container, or **From the container's gap**. A site that already has a page, a component or a Layout of its own (the seeded default Layout does not count) is put on Classic once, when it first starts on this version, so its pages render exactly as before: headings keep their 1.5em above and 0.5em below, paragraphs their 1em below, Divider and Quote their 1.5em, Sections and Cards stay unpadded, Columns, Gallery and Accordion keep the `space.4` gap, Buttons keep 0.5rem × 1rem, and no container writes a gap. A new site starts on the container's gap. The step runs once and never overrides a choice made under Design → Variables; to move an existing site to container gaps, choose **From the container's gap** there. Under Classic the spacing variables `space.stack`, `space.section-y`, `space.gutter`, `space.columns`, `space.card`, `space.paragraph`, `button.padding-y` and `button.padding-x` are not used.

The choice is kept in a new table of the plugin's own, `page_builder__site_options`, which the plugin's migration creates: run `npx nextly migrate`. `loadSiteStyle` reads it through the Direct API's plugin services, so a published route passing a Nextly instance needs no change; a page stylesheet stored under the other model is recompiled on its next render. `SiteSheetInput` and the style compile context take an optional `spacingMode` (`"classic" | "gaps"`), the engine exports `SpacingMode`, `SPACING_MODES`, `DEFAULT_SPACING_MODE`, `isSpacingMode` and `spacingModeOf`, and a block's render arguments carry `spacingMode`.
