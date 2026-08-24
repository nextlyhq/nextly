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

A preview link no longer shows its recipient fields the person who shared it cannot see.

A granted draft read is trusted — that is what lets the working draft appear at all, since the
overlay is gated on edit capability while a preview route resolves anonymously. But ONE flag
decided both row trust and FIELD trust, so trusting the row switched field-level read rules off
along with it and the page rendered every field. An editor denied a field could therefore read it
by sharing a link and opening it themselves.

Those two trusts are now separate. A read can say `enforceFieldAccess: true` beside
`overrideAccess: true` — keeping the row bypass, giving up the field one — and the rules are then
evaluated as the `user` it names, inside the query pipeline's own before-and-after-hooks passes.
That placement matters: an `afterRead` hook runs between them, so a hook cannot copy a denied field
onto an allowed one. Omitting the new option is exactly today's behaviour, so no existing caller
changes.

The preview route uses it to render a draft as the person who shared it. The token records who that
was — as a basis for field rules, never as an identity: the bearer is still anonymous and still
reaches exactly the one document the link names. The identity is re-read on every render rather
than frozen into the token, so permissions revoked after a link was shared take effect on its next
render. It is applied to the draft read alone; once a grant stops answering a path the request is
an ordinary anonymous one again, and public content is not judged by a stranger's rules.

A link whose sender cannot be identified — an account since deleted, or a token minted before the
record existed — is refused rather than rendered. Rendering it as nobody would apply no field rules
at all, which is the leak itself; the visitor sees the published page or a 404, the same as an
expired link. Links minted in the hour before this ships therefore stop working, and re-sharing is
the remedy.

One limit worth knowing. A deployment authenticating through its own provider can put arbitrary
claims on a token, and those exist only for the duration of a request. A field rule reading one
sees it absent here — and absence is not the safe direction, since `user.tier !== "restricted"`
passes when `tier` is missing. Such a rule can show a field in a preview that it withholds from the
sharer's own admin view.
