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
refusal that names what a developer must add when no preview URL is declared. On a localized Single
the link is scoped to the language being edited — including the DEFAULT language, where the editor
represents the active locale as "none". An absent locale claim is not "the default language": it
authorizes every locale, so a link minted that way would open translations that have never been
published.

Minting evaluates the Single's own stored access rules, not just the coarse per-slug permission.
Owner-only, role-based and custom rules are decided against the loaded document and can deny a
caller who holds the permission — and a link is a bearer credential for the draft, so authorizing it
on the permission alone handed out a view the real update path refuses. That evaluation is now one
function shared with version history, which gates the same kind of disclosure for the same reason.

**`createSingleRoute` and `createSinglePage` gain `trustedCollections`, and it defaults to nothing.**
A draft grant names ONE document and says nothing about what that document points at, so the
trusted read it triggers no longer spreads to everything the Single populates — a target reached
through a relationship is read the way an anonymous visitor would read it unless you name it:

```ts
createSinglePage({
  slug: "landing-page",
  field: "hero",
  trustedCollections: ["posts"],
  draft: previewSingleDraftGate(),
});
```

This is the same option, with the same meaning, that `createContentRoute` already carries. It only
ever narrows, and it applies to `createPublicSingleRoute` too — a public Single page that populates
relationships and needs them read as trusted must now name those collections.
