---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---


Design token files now carry the whole design, not just the variables. "Export design tokens (.json)" writes everything a fresh site needs to look the same, and "Import design tokens…" brings it back.

- **Shadows** are DTCG `shadow` values: one object per layer with its colour, X and Y offset, blur, spread and inset. A colour variable is written as an alias such as `{color.brand}`. A shadow whose CSS doesn't read as those fields stays Nextly-only data, as before. A shadow from another tool's file reads back as CSS.
- **Text styles** are DTCG `typography` values under a `textStyles` group. Each part a style takes from a variable points at it, as in `{font-size.h2}`. A part the style leaves unset is written as the text it sits in draws it. Every text style is also kept exactly as Nextly data, including its sizes per device and its case, and that copy is what an import reads. "What wasn't exported" lists a text style design tools can't read as "Kept for Nextly only".
- **Site text rows, the colour order, the fluid range and the built-in colours setting** are Nextly data at the file's root. A colour's group and a fluid size's two sizes ride in that variable's own Nextly data. The file also names the variables in the site's order, so an import into a fresh site writes the same variable CSS byte for byte. Other tools keep this data and ignore it, and the file stays valid DTCG 2025.10. An older Nextly reads what it knows and ignores the rest.
- **The import preview** names the file's text styles and its Site text, colour order, fluid range and built-in colours setting. It also lists "Fonts this site doesn't have", with "Add from Google Fonts" for a font the catalogue has. Fonts travel by name only.
- **On import**, the variables and the site's design data are stored as one edit. A Site text row the file states replaces the site's, and the rest stay. Text styles are stored through the editor's class writer, matched by id. A text style whose name another text style already has is refused, by name. So is one whose code name another style on the site already uses, and one locked on this site that the file would change. A text style arrives unlocked (a lock is set on each site), and its values for a breakpoint the site doesn't have are left out, saying which. Where nothing can store text styles, the preview says they weren't imported. A Site text row that follows a text style the import doesn't store keeps the site's own row, said by name. Where a file's variable merges into one this site renamed to that code name, the file's text styles and Site text follow it there. The text styles are stored before the variables and Site text, so Undo takes an import back row first, then the text styles. Both writes go through the same checks as any Design edit, so a role that may not change the design is refused.
- **"Export for Figma"** still writes one file per mode. "What wasn't exported" lists each shadow and text style with "Figma keeps these as effect styles and text styles; the variables they use are in the file".
- **A page or component export** also carries the colour variables a shadow names through `var()`: in a block's or a shared style's shadow, and in a shadow variable's own value.
- **API additions:** `tokensToDtcg` takes an optional `{ textStyles }` and also returns `keptTextStyles`. `dtcgToTokens` and `resolverToTokens` also return `site` and `textStyles` when the file has them. `TEXT_STYLES_GROUP` and the types `DtcgSiteData`, `TokensToDtcgOptions` and `ModesRead` are exported from `@nextlyhq/blocks-engine`. In `@nextlyhq/builder`, `exportDtcg`, `exportDtcgWithTheme` and `exportForFigma` take an optional list of the site's classes, `planImport` takes an optional context (the site's classes and fonts), and `useVariablesHeader` takes optional `currentClasses`, `onEditClasses` and `catalogue`. Older files, with none of the new data, import as before.
