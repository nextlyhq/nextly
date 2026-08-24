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

Singles can be previewed. A Single is draftable — it carries the same Draft / Published lifecycle a
collection does — and was structurally unable to produce a shareable link: the preview token could
only name a collection and an entry id, and a Single has neither.

A preview token now names either an entry or a single. Every token already minted keeps verifying,
byte-identically: the entry variant's discriminator is optional and an entry token is still signed
without it. An unrecognised kind is refused rather than defaulted.

Declare where a Single is served, as you would for a collection:

```ts
export const Homepage = defineSingle({
  slug: "homepage",
  status: true,
  admin: { preview: { url: () => "/" } },
});
```

Then gate the route that renders it — `createSingleRoute` for a hand-rendered Single, or
`createSinglePage` for one built in the page builder, which accepts the hook now:

```ts
const { SinglePage, generateMetadata } = createSinglePage({
  slug: "homepage",
  field: "layout",
  draft: previewSingleDraftGate(),
});
```

`previewSingleDraftGate()` answers yes or no rather than handing back an id, because a Single has
exactly one document: the gate's subject and the token's subject are the same thing, so there is no
second row to check the answer against. A granted draft read is trusted and uncached — trusted
because the working-draft overlay is gated on edit capability while the route resolves anonymously,
and an enforced read would return published values while reporting success; uncached because a
draft is per-visitor, and one cached draft is served to everyone who asks next.
`createPublicSingleRoute` refuses the hook outright for that reason.

The Single editor offers "Copy shareable link" on the same terms as the entry editor, including the
refusal that names what a developer must add when no preview URL is declared.
