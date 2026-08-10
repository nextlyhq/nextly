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

`core/image` and `core/embed` consult it. For the image, the check is applied to whichever URL was SELECTED rather than to the typed one alone: a URL the resolver returned came out of a media record a person filled in, so it names a host on the same terms the typed prop does, and checking one of the pair leaves the other unbounded.

`core/embed` consults it, and an unlisted host renders nothing at all rather than an empty frame, for the reason the empty source already renders nothing: a frame with no usable source loads the page inside itself in several browsers. A caller who passed their own `mayFetchUrl` keeps it, since that is the more specific answer and deriving one here would silently replace it. Absent means unasked rather than allowed-nothing, so a host that configures no list renders exactly as it did before.

**Enforcement is per-renderer, and the type says so where someone reading it will find out.** The boundary cannot apply this on a block's behalf: it sees the element a block RETURNED, not the URLs the block chose, and an `<img src>` deep inside returned markup is indistinguishable to it from any other prop. The blocks shipped here consult the list; a block written outside this package is bounded by it only if it asks. A site wanting a hard limit should pair this with a content security policy, which the browser enforces whatever a block does.

`core/embed`'s `rendersNothing` still answers from its props alone, deliberately. The declaration is read without a render and so has no policy to consult; a URL the policy will refuse is reported there as output and then draws nothing. That direction costs an empty rule in a stylesheet, where the other would claim a drawing block draws nothing.

A stored stylesheet now records which policy compiled it. The artifact is a CACHE of a compile, and a cache is sound only when it is keyed on every input that compile used; the fetch list is such an input, because the same document compiled under two different lists produces two different sheets, one of which may name a host the other refuses. Without that key a sheet written before a policy existed keeps publishing `url(https://unlisted…)` on a site that has since forbidden it, with the block markup beside it bounded and the stylesheet not.

So `PageStyles` gains an opaque `fetchPolicyId`, derived from the patterns themselves rather than assigned, so it changes exactly when they do and there is nothing to remember to invalidate. A reader whose policy does not match the stamp treats the sheet the way it already treats one compiled from a larger tree: recompile when the inputs are there, withhold the CSS when they are not. A sheet that WAS compiled under the current policy is still served from the store, which is why this is a stamp rather than recompiling unconditionally: a site with a policy does not pay a compile per render.

`fetchPolicyLabel` is public because the write path needs it. A writer that could not compute the same label would stamp nothing, every stored sheet would read as stale, and a site with a policy would recompile for ever.

The type documentation no longer claims every field defaults closed, because two fields now default differently and a host reading the old sentence could omit configuration believing remote fetches were denied. `trustedFrameOrigins` defaults closed, since the grant it controls lets a frame script the page around it. `remotePatterns` defaults OPEN, because it arrived after the renderer shipped and defaulting it closed would stop every existing site loading its own images the day it upgraded.

`core/image` asks the list BEFORE choosing between its two candidates rather than after. Selecting first and filtering after meant a library image the site will not fetch beat a perfectly good typed URL and then took the whole block down with it: the author was left with nothing because of a setting they cannot see, while the fallback they wrote sat unused. Filtering first makes the block render the first candidate it is actually allowed to load, which is what a fallback is for — and it is what the link-preview path does with the same pair, so the page and the preview can no longer choose different images. A record whose URL is refused is dropped WHOLE, since its alt text and intrinsic size describe the asset that was refused.

The page-builder's own guidance is corrected in the same change. It told an integrator that `@nextlyhq/blocks-react` had no way to bound fetched hosts and to configure the separate page-builder renderer instead. That is now false, and believing it would leave the published page unbounded while the editor was configured — the editor refusing a host the live page then loads.
