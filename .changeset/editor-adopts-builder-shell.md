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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The page-builder editor adopts the builder shell for its chrome.

The editor hand-rolled a three-pane layout, a toolbar and a breakpoint switcher. The shell supplies all of that as slots, so the editor passes its canvas, inspector, block library and device switcher into it rather than laying them out. The drag provider and its overlay are untouched: the shell owns no drag machinery and never looks inside the canvas slot.

The shell no longer renders the document primary landmark. Its canvas region was a main element, and every mount sits inside a host that already has one, so a second gave assistive technology two competing primary landmarks. It is a named region now, which is also the more accurate description of an editor embedded in a page that owns its own primary content.

Leaving the editor is optional. A host with nowhere to return to, such as the editor embedded as a field inside an entry form, gets no exit affordance at all rather than one that does nothing.
