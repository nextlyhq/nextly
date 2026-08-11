# @nextlyhq/builder

The visual page-builder editor: the shell, the canvas, and the op store that
everything in it either produces or reads.

**It ships no features yet.** The package exists ahead of them so its name is
claimed on npm — trusted publishing cannot perform a package's first publish, and
the bootstrap script will not claim a name that is not already a workspace
package. There is nothing to install it for until the editor lands.

## What this package is not

**It is not a renderer.** The canvas draws documents through
`@nextlyhq/blocks-react` — the same renderer that serves published pages — and
re-implements nothing downstream of the document model. Read-path preparation,
condition gating and slot pruning are consumed from the engine's own entry
points, never reproduced here.

That rule is not stylistic. `plugin-page-builder` carries a second renderer of
its own, and the two disagree about condition gating in opposite directions: one
fails closed, the other does not evaluate conditions at all. Sharing a predicate
would not have prevented that, because sharing a predicate does not share the
decision to call it. Only sharing the entry point does.

## The layering contract

`src/layering.test.ts` enforces two boundaries as a build failure:

1. **Never `@nextlyhq/admin` directly.** Admin is reached only through
   `@nextlyhq/plugin-sdk/admin`, a curated facade where every export is named
   individually and carries a stability tag. A direct import bypasses the facade
   and takes a dependency on internals nobody promised to keep. The pull toward
   it is concrete: the editor wants admin's Lexical node set for inline rich
   text.
2. **Never the CMS runtime.** The allowlist is **exact specifiers**, not
   packages, because subpaths are where the coupling lives —
   `@nextlyhq/blocks-react/next` imports `nextly/runtime`, and the
   `@nextlyhq/plugin-sdk` root re-exports runtime values from `nextly`. Only
   `@nextlyhq/plugin-sdk/admin` is admitted, and only the root entry of
   `blocks-react`.

The guard reads every shape that reaches a module — static imports and
re-exports, `import()`, bare `require()`, `import x = require()`,
`typeof import()`, and triple-slash type references — because each of those has,
at some point, walked straight past a narrower version of it.

**What the guard does NOT prove:** that the canvas renders _through_
`blocks-react` rather than reimplementing rendering on React and
`blocks-engine`. Both spellings import exactly the same packages, so no import
scan can separate them. That rule is held by review. The allowlist makes the
shortcut inconvenient; it cannot make it impossible.

Adding an allowlist entry is a deliberate act with a reason recorded beside it.

## Public surface

`BUILDER_PACKAGE_NAME` — this package's npm name, for diagnostics that report
which packages a host loaded. The name and not the version: a version literal in
source would be stale one release after it was written, because every release
bumps this package in lockstep with its siblings.

## Development

Run these from this directory (`packages/builder`), not the repository root —
turbo swallows the summary line at the root.

```bash
pnpm run test          # vitest, including the layering guard
pnpm run check-types   # tsc --noEmit; unlike some packages here, this DOES
                       # cover the test files (tsconfig has no test exclude)
pnpm run lint          # eslint --max-warnings 0; a single warning fails
pnpm run build         # tsup
```

## Peer dependencies

React 19, matching the renderer it draws with. `@nextlyhq/blocks-react` requires
`react: ^19.0.0`, and it is a dependency here rather than a peer, so a React 18
host would hit an unsatisfiable peer one level down.
