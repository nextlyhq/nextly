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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A stored page stylesheet now records which shared style inputs it was compiled against.

A page's compiled CSS is cached beside the document and reused on later renders.
That cache was keyed on the host-fetch policy alone, so three site-level inputs
could move underneath it with nothing noticing: the breakpoints, whose ids and
bounds decide every at-rule; the token prefix, which renders into every `var()`
the sheet references; and the named-class library, whose slugs become the
selectors themselves.

When one moved, the newly compiled site sheet and the stored page sheet stopped
agreeing and CSS failed silently — an unresolved custom property invalidates its
declaration rather than reporting, and a selector nothing declares never
matches. The page rendered, partly unstyled, with no error anywhere.

`PageStyles` gains `sharedInputsId`, a digest of those three inputs, compared on
every render and treated as a repair cause when it disagrees. Artifacts written
before this field existed carry no stamp and are recompiled against any render
that states its inputs. The resolver RETURNS the stamped result and does not
write it, so whether that is paid once or on every request depends on whether
the caller persists or caches what it gets back.
