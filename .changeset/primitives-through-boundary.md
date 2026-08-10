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

The contract covers every value React draws as nothing, not only `null` and `undefined`. A plugin block written in the ordinary conditional form `render: () => enabled && <element />` returns `false` when disabled, and an empty string arrives the same way from a cleared value. Any ITERABLE counts, when every member does, and so does an empty fragment: `items.map(...)` over an empty collection and `<>{items.map(...)}</>` around one are the same intent spelled three ways. The walk is a bounded `for...of` inside a try rather than `Array.prototype.every`, because `every` is author-controllable and calling it would run plugin code outside the block's containment, where a throw costs the whole page instead of one block.

Emptiness is only trusted when it is read the way React will read it. A value the block RETURNS is materialised by the normalizer into an array this renderer owns, so one pass answers for both. A value reached through an element the block already built is borrowed, and React reads it again from the same object: an array is indexed off that object, and a `Set` answers from an internal slot the iterator React uses reads too. Any other iterable answers by running the block's own `Symbol.iterator` a third time, after the normalizer's pass and before React's, so one that yields differently on each call could read empty here and hand React an element, which reached the DOM without the `cssId` the node asked for, or threw uncontained when it was not renderable at all. The `Set` shortcut carries the same condition: a `Set` may define its OWN iterator, and its slot stays empty however that iterator behaves, so the shortcut is taken only when the iterator is the built-in one. Everything else is judged as drawing, which keeps the diagnostic.

Reading a wrapper's props is contained for the same reason. A getter or a proxy trap raises after the block's own `try` has returned, where it costs the page rather than the block. Calling a wrapper empty also hands the WRAPPER to React, which renders it and reads props this check does not look at, such as a context provider's `value`, so those are read here too: the read React was going to make happens inside the containment instead of outside it. Every TRANSPARENT wrapper is opened to judge its children — fragments, `StrictMode`, `Profiler`, `Activity`, `Suspense` and context providers. The set is the normalizer's own, shared rather than copied, so a wrapper cannot be walked to validate its children in one place and misreported as output in the other. `Suspense` belongs despite its fallback: the fallback draws only while children are pending, and structurally empty children cannot suspend, while a child that can suspend is not empty and is already answered by the recursion. A component is never opened, since React hands a component its children as an ordinary prop it may ignore. A single-use iterator is refused before emptiness is considered, because React does not accept one as a JSX child at all. `0` is deliberately excluded, since React renders it as the character zero: that is real output with no element to carry the node's fields, so it stays a diagnostic, as does any list that draws something.

`core/image` also discards a resolved media record whole when the URL filter refuses it, rather than only its URL. The record's alt text and intrinsic size describe the asset that was rejected, so keeping them beside the fallback URL announced one image to a screen reader while reserving the other one's space.

The primitives were only ever tested by calling their render functions directly, which is not the path a page takes: the boundary appends the block type class, clones the node fields onto the root, and normalizes the output first. That gap is why this defect and two others reached main.
