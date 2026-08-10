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

Ask one host list, from both channels a page fetches through.

`BlockHostPolicy` now carries `remotePatterns`, in the same shape a Nextly app already declares in `next.config` for `next/image`, so copying the entry across just works. A block writes an `<img src>` or an `<iframe src>`; a compiled stylesheet writes `url(...)` into a rule that fires on every page it applies to. Both turn a stored value into a request, and both now ask THIS list rather than each keeping its own, because a policy two surfaces answer differently is not a policy. The style channel asks it through the predicate the engine takes, so the two cannot drift.

`core/embed` consults it, and an unlisted host renders nothing at all rather than an empty frame, for the reason the empty source already renders nothing: a frame with no usable source loads the page inside itself in several browsers. A caller who passed their own `mayFetchUrl` keeps it, since that is the more specific answer and deriving one here would silently replace it. Absent means unasked rather than allowed-nothing, so a host that configures no list renders exactly as it did before.

**Enforcement is per-renderer, and the type says so where someone reading it will find out.** The boundary cannot apply this on a block's behalf: it sees the element a block RETURNED, not the URLs the block chose, and an `<img src>` deep inside returned markup is indistinguishable to it from any other prop. The blocks shipped here consult the list; a block written outside this package is bounded by it only if it asks. A site wanting a hard limit should pair this with a content security policy, which the browser enforces whatever a block does.

`core/embed`'s `rendersNothing` still answers from its props alone, deliberately. The declaration is read without a render and so has no policy to consult; a URL the policy will refuse is reported there as output and then draws nothing. That direction costs an empty rule in a stylesheet, where the other would claim a drawing block draws nothing.
