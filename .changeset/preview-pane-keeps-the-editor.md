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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

Opening or closing the preview no longer throws away work in progress.

The preview pane wrapped the editor only while it was open, so every toggle put
the editor at a different place in the component tree and React unmounted and
rebuilt the whole thing. Anything a field was holding that had not yet reached
the form went with it — and the field most likely to be holding something is the
one deliberately keeping a value the form would reject, such as JSON mid-edit
that is not valid yet. Clicking Preview discarded it silently: no error, no
prompt, the field simply showed its last saved value again.

The editor now stays in one place whether the preview is open or shut. Closed,
the pane's own elements generate no box at all, so the page is laid out exactly
as it would be if the pane were not there — the same mechanism the editor
already uses to hand its measure to the page builder.

The split itself is now built from ordinary elements rather than the resizable
panel library, because that library sizes its panels with inline styles that no
stylesheet can stand down: a panel wrapping the editor while the preview was
closed would clip it and move scrolling off the page. The divider keeps its
keyboard support — arrow keys nudge it, Home and End take it to either limit —
and reports its position to assistive technology as it moves.
