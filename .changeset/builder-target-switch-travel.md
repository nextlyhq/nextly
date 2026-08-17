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

feat(builder): hold a drop target until the pointer has travelled a threshold

A pointer resting near the boundary between two drop targets jitters by a pixel
or two and the target underneath it alternates, which shows as a flickering
insertion indicator and as a block landing where the author did not aim.

`nextTargetSwitchState` makes a rival target hold while the pointer travels a set
distance before it replaces the committed one. It reads two points and a number
and no geometry at all, so a 1px divider, an author-set 0px spacer, a 900px hero,
a vertical stack and a grid all behave identically — a minimum-size rule cannot
say that, because a spacer's height has no lower bound and any pixel floor makes
some authored block impossible to drop beside.

The threshold is measured from where the candidate first differed from the
committed target, not from where the last switch happened. The latter is
satisfied by construction before the pointer reaches any seam, so it would be met
exactly where it is not needed and never where it is.

Not yet exported from any entry point: it has no consumer until a canvas wires it
up, and an unused public export is a surface with no caller to keep it honest.
