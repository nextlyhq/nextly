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
---

Let a block render nothing without being reported as broken, and test the core primitives through the boundary that wraps them.

A block that deliberately renders nothing, such as an image with no usable source, was replaced by a broken-block diagnostic when its node also carried an anchor id. Rendering nothing is a decision rather than a failure, and the two now have different answers. This is a contract for every block, including ones written outside the package, rather than a special case for the two that need it today.

The contract covers every value React draws as nothing, not only `null` and `undefined`. A plugin block written in the ordinary conditional form `render: () => enabled && <element />` returns `false` when disabled, and an empty string arrives the same way from a cleared value. Any ITERABLE counts, when every member does, and so does an empty fragment: `items.map(...)` over an empty collection and `<>{items.map(...)}</>` around one are the same intent spelled three ways. A fragment's children are borrowed JSX validated where they lie rather than materialised, so a `Set` arrives as a `Set` and is walked as one. The walk is a bounded `for...of` inside a try rather than `Array.prototype.every`, because `every` is author-controllable and calling it would run plugin code outside the block's containment, where a throw costs the whole page instead of one block. Every TRANSPARENT wrapper is opened to judge its children — `Fragment`, `StrictMode`, `Profiler`, taken from React's own exports so the list cannot drift from what this React treats as transparent. `Suspense` is excluded because it draws a fallback, so empty children do not mean empty output. A component is never opened, since React hands a component its children as an ordinary prop it may ignore. A single-use iterator is refused before emptiness is considered, because React does not accept one as a JSX child at all. `0` is deliberately excluded, since React renders it as the character zero: that is real output with no element to carry the node's fields, so it stays a diagnostic, as does any list that draws something.

`core/image` also discards a resolved media record whole when the URL filter refuses it, rather than only its URL. The record's alt text and intrinsic size describe the asset that was rejected, so keeping them beside the fallback URL announced one image to a screen reader while reserving the other one's space.

The primitives were only ever tested by calling their render functions directly, which is not the path a page takes: the boundary appends the block type class, clones the node fields onto the root, and normalizes the output first. That gap is why this defect and two others reached main.
