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

Margin and padding are set from a popover on each side of the spacing box.

- Each side shows its value whole ("10px", "XL"). A value too long for its cell ends in "…", with the whole value in its tooltip and its accessible name.
- Clicking a side (or Enter) opens a popover titled with the side ("Padding top"). It holds:
  - the site's spacing variables as presets, smallest first, after "None";
  - a number with its unit menu, which includes `auto` for margins;
  - "Apply to: This side / Top & bottom / All sides" ("Left & right" for a left or right side). This writes every side it names in one undo step, and the choice holds while the panel is open.
- Typing a digit on a side starts quick entry: "4 0 Tab 4 0 Tab…" sets each side in turn. The popover never traps focus: Tab past its last control moves on to the next side, and Escape returns to the side.
- A side whose value comes from a spacing variable shows the variable's name in green, and the box says "Green values come from your spacing variables." The box no longer has a ◇ button.
- Reset is in the popover's ⋯ menu and the side's right-click menu, and Alt+Backspace on the side still resets it, a variable included.
