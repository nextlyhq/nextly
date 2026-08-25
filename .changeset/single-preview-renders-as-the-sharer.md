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

A preview link for a Single no longer shows its recipient fields the person who shared it cannot
see. Collections were repaired separately; this is the same defect on the Single path.

A granted draft read is trusted — that is what lets the working draft appear at all, since the
overlay is gated on edit capability while a preview route resolves anonymously. But one flag
decided both document trust and FIELD trust, so trusting the document switched field-level read
rules off along with it. An editor denied a field could read it by sharing a link and opening it
themselves.

`previewSingleDraftGate` now answers a grant that NAMES the sharer rather than a bare boolean, and
the route carries that identity into the read as a redaction basis — never as the caller. Every
hook goes on seeing the anonymous visitor who is actually asking: a hook branching on the caller
would otherwise produce an editor-only value for whoever holds the link, and a value a hook invents
need not be a declared field, so redaction could not take it back.

`SingleRouteConfig.draft` accordingly returns `SingleDraftGrant` instead of `boolean`. A literal
`true` still grants, for a route mounted behind the application's own auth where every visitor is
already entitled to the draft; it names nobody and so judges by nobody, which is the previous
behaviour it preserves.

Revocation reaches links already in circulation, and it takes two things rather than one. The
identity is re-read on every render, so a deleted or deactivated account stops rendering at once.
But rebuilding an identity re-evaluates field rules and nothing else — the read still bypasses the
Single's own document rules — so the render also re-asks the question the mint asked: may this
person still preview this Single. `assertSinglePreviewable` takes `routeAuthorized` per call site
for that reason: true for the mint, which runs behind the route's access gate, and false for a
render, which is anonymous and has none.

A link whose sender cannot be identified — an account since deleted or deactivated, or a token
minted before the record existed — is refused rather than rendered. Rendering it as nobody applies
no field rules at all, which is the leak itself; the visitor sees the published document or a 404,
the same as an expired link.

One limit is unchanged and worth repeating: a deployment authenticating through its own provider
can put arbitrary claims on a token, and those exist only for the duration of a request. A field
rule reading one sees it absent here, and absence is not the safe direction.
