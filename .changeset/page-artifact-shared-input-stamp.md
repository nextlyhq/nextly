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
That cache was keyed on the host-fetch policy alone, so four site-level inputs
could move underneath it with nothing noticing: the breakpoints, whose ids and
bounds decide every at-rule; the token prefix, which renders into every `var()`
the sheet references; the named-class library, whose slugs become the selectors
themselves; and the block-type defaults, which are emitted into that same sheet.

When one moved, the newly compiled site sheet and the stored page sheet stopped
agreeing and CSS failed silently — an unresolved custom property invalidates its
declaration rather than reporting, and a selector nothing declares never
matches. The page rendered, partly unstyled, with no error anywhere.

`PageStyles` gains `sharedInputsId`, a digest of those inputs, compared on every
render and treated as a repair cause when it disagrees. Artifacts written before
this field existed carry no stamp and are recompiled against any render that
states its inputs. The resolver RETURNS the stamped result and does not write it,
so whether that is paid once or on every request depends on whether the caller
persists or caches what it gets back.

`PageRenderer` derives the identity from the site styles it was given as well as
from a compile context, so the ordinary route — a stored artifact plus
`siteStyles`, compiling nothing itself — is covered rather than exempt. Because
those inputs can also compile a replacement, a refusal there recompiles the sheet
instead of withholding it.

The identity is taken over what the compiler READS, not over what was stored,
which is the difference between invalidating a page and invalidating the site.
Breakpoints are read through the engine's normalisation, so a definition it
discards moves nothing; the token prefix is the one tokens are actually written
under, so swapping one rejected spelling for another moves nothing; and block
defaults are narrowed to the types a page draws, so a default changing for a
block it does not hold moves nothing. A stored record wider than the compiler
will read declines to identify the inputs at all rather than being read past
that bound, which recompiles rather than reusing a sheet that was only partly
described.

`PageRenderer` also hands the site's own `mayFetchUrl` to the compile it
synthesizes from `siteStyles`. The shared sheet has always honoured it, the
page sheet is emitted after, and a page compiled under weaker rules would
publish a request the sheet beside it was refused.

A class or block-base envelope is read only under the states the compiler emits
from. `compilePageCss` iterates `STYLE_STATES` and never reaches a key outside
it, so two envelopes differing only under an unrecognised state compile to the
same CSS — reading the whole object rejected every stored artifact over a
difference no stylesheet can show. The state list is imported rather than
restated, so it follows the engine rather than drifting from it.

Block defaults are narrowed to the types a page draws in ONE place, the
resolver, so the exported entry point and the renderer cannot answer
differently. `resolvePageStyles` gains `storedDocument` for the caller that
pruned before calling it: the documented flow is prune-then-resolve, and two of
those prunes are licensed to KEEP the stored artifact, so an identity derived
from what survived would drop a type whose last node such a prune removed and
refuse the very sheet it was allowed in order to reuse.

`breakpointContexts` now bounds a stored axis BEFORE it sorts. The per-axis
limit bounded its output and not its work, so an axis of a million definitions
was filtered and sorted in full on the way to keeping seven — paid by every
reader keyed on which breakpoints a site emits under, including one whose
stylesheet is reusable. Past `MAX_SCANNED_KEYS` definitions on one axis the
survivors are now chosen from a prefix; nothing legitimate reaches that, since
the declared limit is seven.

`@nextlyhq/blocks-engine` exports `breakpointContexts`, `safeTokenPrefix`,
`MAX_SCANNED_KEYS` and `MAX_NAMED_CLASS_NAME_LENGTH`: the compiler's own normalised breakpoints, the prefix tokens
are really written under, and the width past which a stored record is not read.
Anything keyed on what a stylesheet contains reads these rather than the stored
settings, which change without the output changing.
