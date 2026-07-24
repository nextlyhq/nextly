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

## What deliberately does NOT live here

- No React, no Next.js, no Nextly runtime imports — enforced by test. The
  engine must be usable from Node scripts, edge runtimes, browsers, and
  external agents alike.
- No storage access: breakpoint definitions and other site-level data are
  passed in as context by callers, never read from a database here.
- Style **property** validation and CSS emission (the style compiler), block
  rendering, and the editor are separate packages; this package only owns the
  stored shapes they share.

## Stability

Alpha. The document format carries `formatVersion` and changes to stored
shapes ship with format migrations once the format is frozen.
