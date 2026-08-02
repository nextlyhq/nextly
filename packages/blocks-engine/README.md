# @nextlyhq/blocks-engine

The runtime-free core of the Nextly page builder: the stored document format
and the pure operations over it.

## What lives here

- **The document model** — `BlockDocument` (a `kind`-discriminated envelope
  over a plain `nodes[]` array) and `BlockNode` (namespaced type, required
  schema version, literal props, per-prop `Binding`s, slots-in-node, typed
  styles keyed by state × breakpoint, visibility, locks, custom CSS).
- **Tree operations** — pure, immutable, ID-addressed functions over the node
  forest: `walkNodes`, `findNode`, `locateNode`, `insertNode`, `removeNode`,
  `moveNode`, `duplicateNode`, `updateNode`, `reidSubtree`.
- **Limits** — depth, node-count, and byte caps with a warning threshold.
- **The style-property catalog** — the closed set of style properties a
  document may carry, each declaring the shape of its stored value, the CSS
  property it emits, and the design-token kinds it accepts. Validating a
  document checks its style values against it, so an unknown property or an
  unsafe value is caught by the same gate as any other document defect.

## What deliberately does NOT live here

- No React, no Next.js, no Nextly runtime imports — enforced by test. The
  engine must be usable from Node scripts, edge runtimes, browsers, and
  external agents alike.
- No storage access: breakpoint definitions and other site-level data are
  passed in as context by callers, never read from a database here.
- CSS **emission** (the style compiler), block rendering, and the editor are
  separate packages. The catalog above says what a value must look like to be
  stored; turning it into a stylesheet happens elsewhere, reading the same
  catalog so the two cannot disagree.
- Reading site-level data. Whether a `$token` reference names a token that
  exists, or a class id resolves, IS checked — but only against a lookup the
  caller supplies on the validation context, never by reaching for a database.
  Without one, those names are not checked at all, so a document is judged
  against what it was given and never against what it might have been.

  Those two checks are always warnings, in either mode. A document is data and
  a token table is configuration: an unresolved reference costs one declaration
  and the element renders with what it inherits, so renaming a token must never
  make stored documents unpublishable.

## Stability

Alpha. The document format carries `formatVersion` and changes to stored
shapes ship with format migrations once the format is frozen.
