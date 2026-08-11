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

A block that deliberately renders nothing, such as an image with no usable source, was replaced by a broken-block diagnostic when its node also carried an anchor id. Rendering nothing is a decision rather than a failure, and the two now have different answers.

**Emptiness is judged only from what this renderer can vouch for**, which is the part worth reading twice. Two things earn the exemption: the block DECLARES that its props draw nothing, through the `rendersNothing` contract, which is computed from data this renderer already holds; or the output is a value this renderer OWNS — a primitive React draws as nothing, or an array `normalizeRenderable` materialised, walked by index exactly as React walks it.

Nothing else. A wrapper the block returned is never opened to see whether it is empty. Its children, a provider's `value`, an element's `key` and `ref`, a `Set`'s iterator and an array's iterator are all author-controlled, and React reads every one of them AGAIN after this check has returned — so an exemption granted on a reading React need not repeat is an exemption that can be wrong. It was wrong in five separate ways, two of which took the whole page rather than one block: an iterable that answered differently on each call, a `Set` carrying its own iterator, a getter hidden from enumeration, an inherited getter, and a stateful `children` accessor. The list of properties to probe was never going to close, because every one of them belongs to the author.

The cost is stated plainly: a block returning an empty fragment, an empty `Suspense`, a hidden `Activity` or an empty context provider, on a node that also asks for an anchor id, keeps its diagnostic. That block says `rendersNothing` if it means it, and then the exemption is granted from data rather than from a structure that can change underfoot.

The contract still covers every value React draws as nothing rather than the nullish pair alone. A plugin block written in the ordinary conditional form `render: () => enabled && <element />` returns `false` when disabled, an empty string arrives from a cleared value, and a map over an empty collection arrives as `[]`. A returned `Set` is materialised before it is read, so it counts too. `0` is deliberately excluded, since React renders it as the character zero: real output with no element to carry the node's fields.

A candidate URL clears BOTH filters before `core/image` chooses between them, and a media record whose URL either filter refuses is dropped whole. The two refuse different things — the scheme guard refuses a value that could execute, the host list refuses one the site will not fetch from — and this block had been caught twice applying one of them at one position of the resolver/typed-prop pair and not the other. The same pair reaches the link preview, so both run there too, and the preview publishes the URL in the form the guard normalised rather than the form it was handed.

`SuspenseList` joins the wrapper set the normalizer already accepted as renderable. A type accepted in one list and missing from the other is a wrapper walked to validate its children in one place and reported as output in the other.

The primitives were only ever tested by calling their render functions directly, which is not the path a page takes: the boundary appends the block type class, clones the node fields onto the root, and normalizes the output first. That gap is why this defect and two others reached main.
