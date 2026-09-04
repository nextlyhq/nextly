# @nextlyhq/blocks-engine

The runtime-free core of the Nextly page builder: the stored document format
and the pure operations over it.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/blocks-engine"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq%2Fblocks-engine?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

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
- **The style compiler** — `compilePageCss(doc, ctx)` turns a document's stored
  styles into one stylesheet, plus the class each node should carry and an
  account of anything it refused. A pure function of persisted data: it reads
  the document and the site context a caller loaded, never storage and never a
  block's `render`, so styles are never gathered while something renders. It
  reads the same catalog validation does, and takes validation's verdict rather
  than forming a second opinion, so a document that validates cleanly compiles
  completely and one that does not cannot write what was refused.

## What deliberately does NOT live here

- No React, no Next.js, no Nextly runtime imports — enforced by test. The
  engine must be usable from Node scripts, edge runtimes, browsers, and
  external agents alike.
- No storage access: breakpoint definitions and other site-level data are
  passed in as context by callers, never read from a database here.
- Block **rendering** and the editor are separate packages. This package emits
  the stylesheet; putting elements on a page and letting somebody edit them
  belongs to a renderer, which is also the only thing that can name what a block
  returns.
- **Delivery** of the stylesheet: where the CSS is written, cached or attached
  to a page is the renderer's concern. The compiler returns bytes and a class
  map and has no opinion about either.
- Reading site-level data. Whether a `$token` reference names a token that
  exists, or a class id resolves, IS checked — but only against a lookup the
  caller supplies on the validation context, never by reaching for a database.
  Without one, those names are not checked at all, so a document is judged
  against what it was given and never against what it might have been.

  Those two checks are always warnings, in either mode. A document is data and
  a token table is configuration: an unresolved reference costs one declaration
  and the element renders with what it inherits, so renaming a token must never
  make stored documents unpublishable.

## The override contract

What this package promises about the CSS it emits, and what it promises about
yours: the exact specificity of every rule, what outranks specificity
altogether, and how to override the builder on purpose.

[docs/override-contract.md](./docs/override-contract.md)

## Stability

Alpha. The document format carries `formatVersion` and changes to stored
shapes ship with format migrations once the format is frozen.

## Install

```bash
pnpm add @nextlyhq/blocks-engine
```

Most projects get this transitively through
[`@nextlyhq/plugin-page-builder`](../plugin-page-builder) and do not install it
directly. Install it when you are writing code against the document model itself —
a custom block, a migration over stored documents, or your own tooling.

## Related packages

- [`@nextlyhq/blocks-react`](../blocks-react) — renders these documents
- [`@nextlyhq/plugin-page-builder`](../plugin-page-builder) — the plugin that stores them
- [`@nextlyhq/builder`](../builder) — the editor that produces them

## License

[MIT](../../LICENSE.md)
